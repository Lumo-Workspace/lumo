/**
 * LUM-1200 — one issue on one line gets one Lumo thread: the AI review and
 * the exploit-path hunt reporting the same vulnerability class on the same
 * line are grouped under one kept finding.
 */
import {
  classMatch,
  crossLayerNearMisses,
  groupSameIssue,
  groupingCandidates,
  stillReportedElsewhere,
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
    ['another file', hunt({ filePath: 'src/probe/store.ts' })],
    ['no line', hunt({ line: null })],
    ['a different class', hunt({ ruleId: 'hunt:ssrf' })],
    ['the same layer', f({ fingerprint: 'judge-2', ruleId: 'vuln:xss' })],
    [
      'the same layer on a nearby line with an unrelated title',
      f({
        fingerprint: 'judge-2',
        line: 6,
        title: 'Exit code of the spawned process is ignored',
      }),
    ],
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

    // LUM-1200 follow-up #3 — across the layers a related class (a broad one
    // included) within the line window is enough; the title is not compared.
    it('a broad hunt category on a nearby line joins without a similar title', () => {
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
      expect(g.mergedInto.get('hunt-other')).toBe('judge-crypto')
    })
  })

  // LUM-1200 follow-up #2 — production (probe PR 64, src/probe/order.ts
  // @4cb6b57): two hunt tasks reported the parseQuantity issue; one joined
  // the AI review's thread, the other got a thread of its own, because a
  // group held at most one finding per layer.
  describe('probe PR 64 replay: several hunt reports of one issue', () => {
    const judgeParse = f({
      fingerprint: 'judge-parse',
      ruleId: 'review:logic_error',
      severity: 'MEDIUM',
      filePath: 'src/probe/order.ts',
      line: 13,
      title:
        'parseQuantity returns unvalidated JSON.parse result typed as number',
    })
    const huntHigh = f({
      fingerprint: 'hunt-parse-high',
      ruleId: 'hunt:logic',
      severity: 'HIGH',
      filePath: 'src/probe/order.ts',
      line: 11,
      title:
        'JSON.parse in parseQuantity returns non-numeric values (null, Infinity, NaN, objects) that bypass numeric validation and propagate through orderTotal arithmetic, producing invalid discount calculation',
    })
    const huntMedium = f({
      fingerprint: 'hunt-parse-medium',
      ruleId: 'hunt:logic',
      severity: 'MEDIUM',
      filePath: 'src/probe/order.ts',
      line: 11,
      title:
        'JSON.parse succeeds on non-numeric JSON values without throwing, allowing them to be returned and bypass the numeric validation that the catch block would catch for actual parse errors',
    })

    it('r1: both hunt reports (2 lines away) share the one thread', () => {
      for (const posted of [new Set<string>(), new Set(['judge-parse'])]) {
        const g = groupSameIssue([judgeParse, huntHigh, huntMedium], {
          ...none,
          posted,
        })
        const kept = posted.size > 0 ? 'judge-parse' : 'hunt-parse-high'
        const merged = ['judge-parse', 'hunt-parse-high', 'hunt-parse-medium']
          .filter(x => x !== kept)
          .sort()
        expect([...g.mergedInto.keys()].sort()).toEqual(merged)
        for (const m of merged) expect(g.mergedInto.get(m)).toBe(kept)
        expect(
          (g.mergedOf.get(kept) ?? []).map(x => x.fingerprint).sort()
        ).toEqual(merged)
      }
    })

    it('r3: two hunt reports on the AI review line share its thread', () => {
      const a = f({
        ...huntHigh,
        fingerprint: 'hunt-r3-a',
        line: 13,
        title:
          'Crafted JSON values like null, floats, or objects through parseQuantity produce NaN or zero quantities, bypassing zod schema and enabling zero/free line items or negative totals',
      })
      const b = f({
        ...huntHigh,
        fingerprint: 'hunt-r3-b',
        line: 13,
        title:
          'parseQuantity returns JSON.parse output without runtime type validation, allowing any JSON value (null, float, object, string) to bypass number type checking and reach price calculations',
      })
      const g = groupSameIssue([judgeParse, a, b], {
        ...none,
        posted: new Set(['judge-parse']),
      })
      expect(g.mergedInto.get('hunt-r3-a')).toBe('judge-parse')
      expect(g.mergedInto.get('hunt-r3-b')).toBe('judge-parse')
    })

    it('a chain of nearby hunt reports does not walk the group across issues', () => {
      // C resembles B (L11) but not the kept AI review finding (L13), and
      // sits on another line than B: not joined through B.
      const c = f({
        ...huntHigh,
        fingerprint: 'hunt-chain',
        severity: 'MEDIUM',
        line: 9,
        title:
          'JSON.parse in quantity parsing returns non-numeric values that bypass validation in the cart reducer',
      })
      const g = groupSameIssue([judgeParse, huntHigh, c], {
        ...none,
        posted: new Set(['judge-parse']),
      })
      expect(g.mergedInto.get('hunt-parse-high')).toBe('judge-parse')
      expect(g.mergedInto.has('hunt-chain')).toBe(false)
    })

    it('a hunt report of another issue nearby still gets its own thread', () => {
      const other = f({
        ...huntHigh,
        fingerprint: 'hunt-proto',
        line: 7,
        title:
          'Prototype property lookup in DISCOUNTS object allows attacker to bypass discount allowlist',
      })
      const g = groupSameIssue([judgeParse, huntHigh, huntMedium, other], {
        ...none,
        posted: new Set(['judge-parse']),
      })
      expect(g.mergedInto.has('hunt-proto')).toBe(false)
    })
  })
})

// LUM-1200 follow-up #3 — production TC9 (lumo-agent-test#65 / #66): a hunt
// report one line from the AI review's report of the same issue opened a
// second thread, because the hunt's long claim and the AI review's short
// title share about two words. Across the layers a related class within
// the line window is now enough.
describe('cross-layer pairs need no similar title (LUM-1200 follow-up #3)', () => {
  const judgeAuth = f({
    fingerprint: 'judge-auth',
    ruleId: 'vuln:auth_bypass',
    filePath: 'src/server.ts',
    line: 41,
    title: 'Unauthenticated session creation for any user name',
  })
  const huntAuth = f({
    fingerprint: 'hunt-auth',
    ruleId: 'hunt:logic',
    filePath: 'src/server.ts',
    line: 42,
    title:
      'Sessions are created for any arbitrary username without authentication, allowing unauthorized access by specifying any username',
  })
  const judgeProto = f({
    fingerprint: 'judge-proto',
    ruleId: 'vuln:authz_logic',
    severity: 'MEDIUM',
    filePath: 'src/probe/order.ts',
    line: 7,
    title: 'Discount lookup on plain object reads prototype properties',
  })
  const huntProto = f({
    fingerprint: 'hunt-proto',
    ruleId: 'hunt:logic',
    severity: 'MEDIUM',
    filePath: 'src/probe/order.ts',
    line: 6,
    title:
      'Inherited property access in DISCOUNTS[code] lookup bypasses discount validation, allowing non-numeric truthy values to corrupt order total arithmetic',
  })

  it.each([
    ['#65 r1: auth_bypass L41 / hunt L42', judgeAuth, huntAuth],
    ['#66 r6: authz_logic L7 / hunt L6', judgeProto, huntProto],
  ])('%s: the hunt report joins the AI review thread', (_l, judge, h) => {
    for (const posted of [new Set<string>(), new Set([judge.fingerprint])]) {
      const g = groupSameIssue([judge, h], { ...none, posted })
      expect(Object.fromEntries(g.mergedInto)).toEqual({
        [h.fingerprint]: judge.fingerprint,
      })
    }
  })

  it('applies up to the window edge (3 lines), not past it', () => {
    expect(
      groupSameIssue([judgeAuth, { ...huntAuth, line: 44 }], none).mergedInto
        .size
    ).toBe(1)
    expect(
      groupSameIssue([judgeAuth, { ...huntAuth, line: 45 }], none).mergedInto
        .size
    ).toBe(0)
  })

  it('two hunt reports that both qualify are both listed in the one AI review thread', () => {
    const second = f({
      ...huntProto,
      fingerprint: 'hunt-proto-2',
      line: 7,
      title:
        'Prototype pollution via unvalidated discount code lookup: passing __proto__ resolves Object prototype properties',
    })
    const g = groupSameIssue([judgeProto, huntProto, second], {
      ...none,
      posted: new Set(['judge-proto']),
    })
    expect(g.mergedInto.get('hunt-proto')).toBe('judge-proto')
    expect(g.mergedInto.get('hunt-proto-2')).toBe('judge-proto')
    expect(
      (g.mergedOf.get('judge-proto') ?? []).map(x => x.fingerprint).sort()
    ).toEqual(['hunt-proto', 'hunt-proto-2'])
  })

  it('never merges two AI-review findings through a hunt finding between them', () => {
    const judgeA = f({
      fingerprint: 'judge-a',
      ruleId: 'vuln:auth_bypass',
      filePath: 'src/server.ts',
      line: 40,
      title: 'Unauthenticated session creation for any user name',
    })
    const judgeB = f({
      fingerprint: 'judge-b',
      ruleId: 'review:logic_error',
      filePath: 'src/server.ts',
      line: 44,
      title: 'Session expiry check is bypassed by OR condition',
    })
    const bridge = f({
      fingerprint: 'hunt-bridge',
      ruleId: 'hunt:logic',
      filePath: 'src/server.ts',
      line: 42,
      title: 'An attacker can obtain a session without credentials',
    })
    for (const severityOfHunt of ['HIGH', 'MEDIUM'] as const)
      for (const posted of [
        new Set<string>(),
        new Set(['judge-a', 'judge-b']),
      ]) {
        const g = groupSameIssue(
          [
            { ...judgeA, severity: 'MEDIUM' as const },
            { ...judgeB, severity: 'MEDIUM' as const },
            { ...bridge, severity: severityOfHunt },
          ],
          { ...none, posted }
        )
        const judgeKept = new Set(
          ['judge-a', 'judge-b'].map(x => g.mergedInto.get(x) ?? x)
        )
        // The two AI-review findings never end up under one thread.
        expect(judgeKept.size).toBe(2)
      }
  })

  it('a hunt thread is still reported while the AI review reports its issue a line away', () => {
    const id = (x: GroupableFinding) => ({ ...x, evidence: null })
    expect(stillReportedElsewhere(id(huntAuth), [id(judgeAuth)])).toBe(true)
    expect(stillReportedElsewhere(id(huntProto), [id(judgeProto)])).toBe(true)
    // …and the AI review thread while the hunt reports it.
    expect(stillReportedElsewhere(id(judgeAuth), [id(huntAuth)])).toBe(true)
    expect(
      stillReportedElsewhere(id(huntAuth), [id({ ...judgeAuth, line: 46 })])
    ).toBe(false)
  })
})

describe('crossLayerNearMisses (LUM-1200 follow-up #3)', () => {
  // Production (#66 r4): the hunt's orderTotal report at L20 beside the AI
  // review's parseQuantity at L13 — outside the window, kept apart, logged.
  const judgeParse = f({
    fingerprint: 'judge-parse',
    ruleId: 'review:logic_error',
    severity: 'MEDIUM',
    filePath: 'src/probe/order.ts',
    line: 13,
    title:
      'parseQuantity returns unvalidated JSON.parse result typed as number',
  })
  const huntTotal = f({
    fingerprint: 'hunt-total',
    ruleId: 'hunt:logic',
    filePath: 'src/probe/order.ts',
    line: 20,
    title:
      'orderTotal uses the unvalidated result from parseQuantity in arithmetic (quantity * unitPrice), allowing NaN or boolean coercion to skip price calculations and manipulate order totals',
  })

  it('reports a related pair just outside the window, which is not grouped', () => {
    const g = groupSameIssue([judgeParse, huntTotal], none)
    expect(g.mergedInto.size).toBe(0)
    expect(crossLayerNearMisses([judgeParse, huntTotal], g.mergedInto)).toEqual(
      [
        {
          judgeRuleId: 'review:logic_error',
          huntRuleId: 'hunt:logic',
          distance: 7,
        },
      ]
    )
  })

  it.each([
    ['inside the window', { line: 15 }],
    ['far away', { line: 40 }],
    ['an unrelated class', { ruleId: 'hunt:ssrf' }],
    ['another file', { filePath: 'src/probe/cart.ts' }],
  ])('leaves out a pair %s', (_l, over) => {
    const h = { ...huntTotal, ...over }
    const g = groupSameIssue([judgeParse, h], none)
    expect(crossLayerNearMisses([judgeParse, h], g.mergedInto)).toEqual([])
  })
})

describe('LUM-1200 follow-up #5 groupingCandidates', () => {
  const base = {
    provenance: 'LLM_JUDGE' as const,
    filePath: 'src/server.ts',
    line: 31,
    title: 't',
  }
  const low = {
    ...base,
    fingerprint: 'low',
    ruleId: 'review:logic_error',
    severity: 'LOW' as const,
  }
  const lowThreaded = { ...low, fingerprint: 'low-threaded' }
  const med = {
    ...base,
    fingerprint: 'med',
    ruleId: 'hunt:logic',
    severity: 'MEDIUM' as const,
  }
  const isInline = (f: { severity: string }) => f.severity !== 'LOW'

  it('keeps inline-eligible findings and any finding that has a thread, whatever its severity', () => {
    expect(
      groupingCandidates(
        [low, lowThreaded, med],
        isInline,
        new Set(['low-threaded'])
      ).map(f => f.fingerprint)
    ).toEqual(['low-threaded', 'med'])
  })

  it('never takes a dispositioned finding, even one with a thread', () => {
    const dispositioned = { ...lowThreaded, disposition: 'FALSE_POSITIVE' }
    const inlineDispositioned = {
      ...med,
      fingerprint: 'med-fp',
      disposition: 'ACCEPTED_RISK',
    }
    expect(
      groupingCandidates(
        [dispositioned, inlineDispositioned, med],
        isInline,
        new Set(['low-threaded', 'med-fp'])
      ).map(f => f.fingerprint)
    ).toEqual(['med'])
  })

  it('a LOW thread owner and the same-line hunt report form one group, the owner keeping the thread', () => {
    const groups = groupSameIssue(
      groupingCandidates(
        [lowThreaded, med],
        isInline,
        new Set(['low-threaded'])
      ),
      { posted: new Set(['low-threaded']), isBlocking: () => false }
    )
    expect(groups.mergedInto.get('med')).toBe('low-threaded')
  })
})

describe('LUM-1321 — an imported Claude Code / Codex review joins the issue', () => {
  const agent = (over: Partial<GroupableFinding> = {}) =>
    f({
      fingerprint: 'agent-fp',
      ruleId: 'ext:claude-code:command-injection',
      provenance: 'EXTERNAL_TOOL',
      title: 'Command injection in makeThumbnail',
      ...over,
    })

  it('reads the agent rule as an AI review kind (dashes or underscores), an unknown rule as its own class', () => {
    expect([...issueClasses('ext:claude-code:command-injection')]).toEqual([
      'command_injection',
    ])
    expect([...issueClasses('ext:codex:path_traversal')]).toEqual([
      'path_traversal',
    ])
    // A real Codex run named its rules by CWE (the converter slugs `CWE-78`).
    expect([...issueClasses('ext:codex:cwe-78')]).toEqual(['command_injection'])
    expect([...issueClasses('ext:codex:cwe-22')]).toEqual(['path_traversal'])
    expect([...issueClasses('ext:codex:leaky-logs')]).toEqual([
      'ext:codex:leaky-logs',
    ])
  })

  it("keeps Lumo's AI review thread and lists the agent's report of the same issue under it", () => {
    const judge = f()
    const g = groupSameIssue([agent(), judge], none)
    expect(g.mergedInto.get('agent-fp')).toBe('judge-fp')
    expect(g.mergedOf.get('judge-fp')).toEqual([agent()])
  })

  it('groups with the hunt too, and two agents reporting one issue share the thread', () => {
    const g = groupSameIssue(
      [
        hunt(),
        agent(),
        agent({
          fingerprint: 'codex-fp',
          ruleId: 'ext:codex:command_injection',
        }),
      ],
      none
    )
    expect(g.mergedInto.get('agent-fp')).toBe('hunt-fp')
    expect(g.mergedInto.get('codex-fp')).toBe('hunt-fp')
  })

  it('never joins two issues one agent reported separately, nor a CI scanner row', () => {
    const g = groupSameIssue(
      [
        agent(),
        agent({
          fingerprint: 'agent-2',
          ruleId: 'ext:claude-code:command-injection',
          title: 'Second exec call',
        }),
        f({
          fingerprint: 'semgrep-fp',
          ruleId: 'ext:semgrep:exec',
          provenance: 'EXTERNAL_TOOL',
        }),
      ],
      none
    )
    expect(g.mergedInto.size).toBe(0)
  })
})
