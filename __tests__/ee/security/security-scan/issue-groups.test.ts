/**
 * LUM-1200 — one issue on one line gets one Lumo thread: the AI review and
 * the exploit-path hunt reporting the same vulnerability class on the same
 * line are grouped under one kept finding.
 */
import {
  classMatch,
  groupSameIssue,
  issueClasses,
  type GroupableFinding,
} from '@/ee/security/security-scan/issue-groups'
import { HUNT_CATEGORIES } from '@/ee/security/security-scan/hunt/candidate'
import {
  REVIEW_KINDS,
  isBugKind,
} from '@/ee/security/security-scan/review-kinds'

function f(over: Partial<GroupableFinding> = {}): GroupableFinding {
  return {
    fingerprint: 'judge-fp',
    ruleId: 'vuln:command_injection',
    provenance: 'LLM_JUDGE',
    filePath: 'src/probe/run.ts',
    line: 5,
    severity: 'HIGH',
    title: 'Shell command built by concatenating unsanitized dir argument',
    ...over,
  }
}

const hunt = (over: Partial<GroupableFinding> = {}) =>
  f({
    fingerprint: 'hunt-fp',
    ruleId: 'hunt:injection',
    title:
      'The dir parameter is concatenated directly into an exec shell command without sanitization',
    ...over,
  })

const none = { posted: new Set<string>(), isBlocking: () => false }

describe('issueClasses', () => {
  it('maps the hunt categories onto the AI review kinds they cover', () => {
    expect([...issueClasses('hunt:injection')]).toEqual(
      expect.arrayContaining(['command_injection', 'sql_injection', 'xss'])
    )
    expect([...issueClasses('hunt:ssrf')]).toContain('ssrf')
    expect([...issueClasses('hunt:idor')]).toEqual(
      expect.arrayContaining(['authz_logic', 'auth_bypass'])
    )
    expect([...issueClasses('vuln:command_injection')]).toEqual([
      'command_injection',
    ])
  })

  it('gives secrets and external-tool rules no class (never grouped)', () => {
    expect(issueClasses('secret:aws-access-key').size).toBe(0)
    expect(issueClasses('ext:semgrep:foo').size).toBe(0)
  })

  // LUM-1200 follow-up (probe PR 60): `hunt:logic` had no mapping and
  // `review:` kinds had no class, so neither was ever grouped.
  it('audit: every hunt category maps onto a class, never the bare fallback', () => {
    for (const c of HUNT_CATEGORIES) {
      const classes = issueClasses(`hunt:${c}`)
      expect(classes.size).toBeGreaterThan(0)
      expect(classes.has(`hunt:${c}`)).toBe(false)
    }
    expect([...issueClasses('hunt:race')]).toEqual(['concurrency'])
    expect([...issueClasses('hunt:logic')]).toEqual(
      expect.arrayContaining(['logic_error', 'auth_bypass', 'authz_logic'])
    )
  })

  it('audit: every AI review kind, security or correctness, is its own class', () => {
    for (const k of REVIEW_KINDS) {
      const prefix = isBugKind(k) ? 'review' : 'vuln'
      expect([...issueClasses(`${prefix}:${k}`)]).toEqual([k])
    }
  })
})

describe('classMatch', () => {
  it('exact when the classes overlap, broad for the broad hunt:logic, else null', () => {
    expect(classMatch('vuln:command_injection', 'hunt:injection')).toBe('exact')
    expect(classMatch('review:concurrency', 'hunt:race')).toBe('exact')
    expect(classMatch('review:logic_error', 'hunt:logic')).toBe('exact')
    expect(classMatch('vuln:weak_crypto', 'hunt:logic')).toBe('broad')
    expect(classMatch('hunt:logic', 'review:data_integrity')).toBe('broad')
    expect(classMatch('vuln:weak_crypto', 'hunt:injection')).toBeNull()
    expect(classMatch('secret:aws', 'hunt:logic')).toBeNull()
  })
})

describe('groupSameIssue', () => {
  it('production probe: AI review + hunt injection on run.ts:5 → one kept, one merged', () => {
    const g = groupSameIssue([f(), hunt()], none)
    expect(g.mergedInto.get('hunt-fp')).toBe('judge-fp')
    expect(g.mergedOf.get('judge-fp')?.map(m => m.fingerprint)).toEqual([
      'hunt-fp',
    ])
    expect(g.mergedInto.has('judge-fp')).toBe(false)
  })

  it('keeps the finding whose thread is already on the PR', () => {
    const g = groupSameIssue([f(), hunt()], {
      ...none,
      posted: new Set(['hunt-fp']),
    })
    expect(g.mergedInto.get('judge-fp')).toBe('hunt-fp')
  })

  it('keeps the stricter standing: a blocking finding is the kept one, whatever its severity', () => {
    const g = groupSameIssue([f(), hunt({ severity: 'MEDIUM' })], {
      ...none,
      isBlocking: x => x.fingerprint === 'hunt-fp',
    })
    expect(g.mergedInto.get('judge-fp')).toBe('hunt-fp')
  })

  it('never hides a blocking finding under a non-blocking thread already on the PR', () => {
    const g = groupSameIssue([f(), hunt()], {
      posted: new Set(['judge-fp']),
      isBlocking: x => x.fingerprint === 'hunt-fp',
    })
    // The blocking row keeps a thread of its own.
    expect(g.mergedInto.has('hunt-fp')).toBe(false)
  })

  it('keeps the higher severity when neither is posted', () => {
    const g = groupSameIssue([f({ severity: 'MEDIUM' }), hunt()], none)
    expect(g.mergedInto.get('judge-fp')).toBe('hunt-fp')
  })

  it('never merges two findings that both already have a thread', () => {
    const g = groupSameIssue([f(), hunt()], {
      ...none,
      posted: new Set(['judge-fp', 'hunt-fp']),
    })
    expect(g.mergedInto.size).toBe(0)
  })

  it.each([
    ['another line beyond the window', hunt({ line: 9 })],
    ['a nearby line with an unrelated title', hunt({ line: 6 })],
    ['another file', hunt({ filePath: 'src/probe/store.ts' })],
    ['no line', hunt({ line: null })],
    ['a different class', hunt({ ruleId: 'hunt:ssrf' })],
    ['the same layer', f({ fingerprint: 'judge-2', ruleId: 'vuln:xss' })],
  ])('does not group across %s', (_label, other) => {
    expect(groupSameIssue([f(), other], none).mergedInto.size).toBe(0)
  })

  it('does not group two AI-review classes on one line through a broad hunt category', () => {
    const g = groupSameIssue(
      [
        f(),
        f({ fingerprint: 'judge-sql', ruleId: 'vuln:sql_injection' }),
        hunt(),
      ],
      none
    )
    // Exactly one of the judge rows absorbs the hunt row; the other stays alone.
    expect(g.mergedInto.size).toBe(1)
    expect(g.mergedInto.has('judge-fp')).toBe(false)
    expect(g.mergedInto.has('judge-sql')).toBe(false)
  })

  // Production (probe PR 60, src/probe/session.ts @3202de1): the hunt
  // reported four issues the AI review already had threads for, one to
  // three lines away, under `hunt:logic` — four second threads, one of them
  // re-raising the Math.random issue the developer had resolved.
  describe('probe PR 60 replay', () => {
    const fp = (name: string) => name
    const judgeCrypto = f({
      fingerprint: fp('judge-crypto'),
      ruleId: 'vuln:weak_crypto',
      line: 14,
      title:
        'Session token generated with Math.random despite comment claiming CSPRNG',
    })
    const huntCrypto = f({
      fingerprint: fp('hunt-crypto'),
      ruleId: 'hunt:logic',
      line: 13,
      title:
        'Session tokens use Math.random() instead of CSPRNG, allowing attackers to predict or enumerate valid session tokens with low entropy (~53 bits)',
    })
    const judgeExpiry = f({
      fingerprint: fp('judge-expiry'),
      ruleId: 'vuln:auth_bypass',
      line: 19,
      title: 'Session validity uses || so expired sessions remain valid',
    })
    const huntExpiry = f({
      fingerprint: fp('hunt-expiry'),
      ruleId: 'hunt:logic',
      line: 20,
      title:
        'Session validation uses OR logic (expiresAt > now || token.length > 0) allowing expired sessions to remain valid indefinitely, bypassing authentication expiry controls',
    })
    const judgeProto = f({
      fingerprint: fp('judge-proto'),
      ruleId: 'review:logic_error',
      severity: 'MEDIUM',
      line: 24,
      title: 'Discount lookup on plain object matches prototype properties',
    })
    const huntProto = f({
      fingerprint: fp('hunt-proto'),
      ruleId: 'hunt:logic',
      severity: 'MEDIUM',
      line: 24,
      title:
        'User-controlled discount code is used directly as key on plain DISCOUNTS object, allowing access to prototype properties',
    })
    const judgeParse = f({
      fingerprint: fp('judge-parse'),
      ruleId: 'review:data_integrity',
      severity: 'MEDIUM',
      line: 30,
      title:
        'parseQuantity returns unvalidated JSON.parse result typed as number',
    })
    const huntParse = f({
      fingerprint: fp('hunt-parse'),
      ruleId: 'hunt:logic',
      line: 29,
      title:
        'JSON.parse() result is not validated as a number; arbitrary JSON values (object, array, null, boolean) can bypass the quantity type',
    })
    const all = [
      judgeCrypto,
      huntCrypto,
      judgeExpiry,
      huntExpiry,
      judgeProto,
      huntProto,
      judgeParse,
      huntParse,
    ]
    const posted = new Set([
      'judge-crypto',
      'judge-expiry',
      'judge-proto',
      'judge-parse',
    ])

    it('each hunt report joins the AI review thread for its issue, nearby lines included', () => {
      const g = groupSameIssue(all, { ...none, posted })
      expect(Object.fromEntries(g.mergedInto)).toEqual({
        'hunt-crypto': 'judge-crypto',
        'hunt-expiry': 'judge-expiry',
        'hunt-proto': 'judge-proto',
        'hunt-parse': 'judge-parse',
      })
    })

    it('a thread the developer resolved absorbs the same-severity hunt report (not re-raised)', () => {
      const g = groupSameIssue(all, {
        ...none,
        posted,
        resolvedByUser: new Set(['judge-crypto']),
      })
      expect(g.mergedInto.get('hunt-crypto')).toBe('judge-crypto')
    })

    it('…but not one that is more severe or blocks DONE (the LUM-1127 carry rule)', () => {
      const moreSevere = groupSameIssue(
        [{ ...judgeCrypto, severity: 'MEDIUM' as const }, huntCrypto],
        { ...none, posted, resolvedByUser: new Set(['judge-crypto']) }
      )
      expect(moreSevere.mergedInto.has('hunt-crypto')).toBe(false)
      const blocking = groupSameIssue([judgeCrypto, huntCrypto], {
        posted,
        isBlocking: x => x.fingerprint === 'hunt-crypto',
        resolvedByUser: new Set(['judge-crypto']),
      })
      expect(blocking.mergedInto.has('hunt-crypto')).toBe(false)
      // An open thread still takes in the more severe report (the kept
      // thread's standing is shown with it).
      const open = groupSameIssue(
        [{ ...judgeCrypto, severity: 'MEDIUM' as const }, huntCrypto],
        { ...none, posted }
      )
      expect(open.mergedInto.get('hunt-crypto')).toBe('judge-crypto')
    })

    it('a broad hunt category needs a similar title, even on the same line', () => {
      const g = groupSameIssue(
        [
          judgeCrypto,
          f({
            fingerprint: 'hunt-other',
            ruleId: 'hunt:logic',
            line: 14,
            title: 'Refund endpoint skips the order state machine',
          }),
        ],
        none
      )
      expect(g.mergedInto.size).toBe(0)
    })
  })
})
