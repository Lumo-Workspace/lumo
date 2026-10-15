/**
 * LUM-1127 follow-up — the rule-id-tolerant same-issue match that keeps a
 * thread open when the AI review reports the same issue under a new
 * fingerprint (prod probe PR 52: `review:doc_mismatch` → `review:api_misuse`).
 */
import { createHash } from 'node:crypto'
import {
  crowdedFingerprints,
  evidenceHash,
  hashIdentity,
  identityKeyId,
  isKeyedWith,
  matchSuccessors,
  sameIssueScore,
  titleSimilarity,
  titleTokens,
  type FindingIdentity,
} from '@/ee/security/security-scan/finding-successor'

function id(over: Partial<FindingIdentity> = {}): FindingIdentity {
  return {
    fingerprint: 'old',
    ruleId: 'review:doc_mismatch',
    provenance: 'LLM_JUDGE',
    filePath: 'scripts/probe.ts',
    line: 3,
    title: 'console.log used in scripts',
    evidence: "console.log('probe')",
    ...over,
  }
}

describe('titleSimilarity', () => {
  it('identical titles score 1, unrelated ones near 0', () => {
    expect(
      titleSimilarity(
        'console.log used in scripts',
        'console.log used in scripts'
      )
    ).toBe(1)
    expect(
      titleSimilarity(
        'Arbitrary directory selection via query parameter',
        'Shell command built by concatenating untrusted dir'
      )
    ).toBe(0)
  })

  it('ignores stop words, case and plural forms', () => {
    expect(
      titleSimilarity(
        'exec error silently ignored',
        'Exec errors silently ignored'
      )
    ).toBe(1)
    expect(
      titleSimilarity(
        'writeFile promise not awaited',
        'Promise from writeFile is not awaited'
      )
    ).toBe(1)
  })

  it('an empty title matches nothing', () => {
    expect(titleSimilarity('', 'anything')).toBe(0)
  })

  // LUM-1200 follow-up (probe PR 60): the hunt's long claim vs the AI
  // review's short title — Jaccard alone scored 0.25 for the same issue.
  it('a short title mostly contained in a long one is similar', () => {
    expect(
      titleSimilarity(
        'Session token generated with Math.random despite comment claiming CSPRNG',
        'Session tokens use Math.random() instead of CSPRNG, allowing attackers to predict or enumerate valid session tokens with low entropy (~53 bits)'
      )
    ).toBeGreaterThanOrEqual(0.5)
    // Two shared words are not enough on their own.
    expect(
      titleSimilarity(
        'Session cookie lacks Secure flag',
        'Session tokens use Math.random() instead of CSPRNG'
      )
    ).toBeLessThan(0.5)
  })
})

describe('sameIssueScore', () => {
  it('prod PR 52: relabelled rule, same line, same title ⇒ same issue', () => {
    expect(
      sameIssueScore(
        id(),
        id({ fingerprint: 'new', ruleId: 'review:api_misuse' })
      )
    ).not.toBeNull()
  })

  it('same quoted evidence line after the code moved ⇒ same issue', () => {
    expect(
      sameIssueScore(
        id(),
        id({
          fingerprint: 'new',
          ruleId: 'review:api_misuse',
          line: 40,
          title: 'Debug logging left in script',
        })
      )
    ).toBeNull() // different kind and dissimilar title: not enough
    expect(
      sameIssueScore(
        id(),
        id({ fingerprint: 'new', ruleId: 'review:api_misuse', line: 40 })
      )
    ).not.toBeNull()
    expect(
      sameIssueScore(
        id(),
        id({
          fingerprint: 'new',
          line: 40,
          title: 'Debug logging left in script',
        })
      )
    ).not.toBeNull() // same rule on the same code
  })

  it('nearby line needs a similar title', () => {
    expect(
      sameIssueScore(
        id(),
        id({
          fingerprint: 'new',
          ruleId: 'review:api_misuse',
          line: 5,
          evidence: 'x',
        })
      )
    ).not.toBeNull()
    expect(
      sameIssueScore(
        id(),
        id({
          fingerprint: 'new',
          line: 5,
          evidence: 'x',
          title: 'Loop bound off by one',
        })
      )
    ).toBeNull()
    expect(
      sameIssueScore(
        id(),
        id({
          fingerprint: 'new',
          ruleId: 'review:api_misuse',
          line: 7,
          evidence: 'x',
        })
      )
    ).toBeNull() // beyond the window
  })

  it('another file, or a non-AI finding, is never the same issue', () => {
    expect(
      sameIssueScore(
        id(),
        id({ fingerprint: 'new', filePath: 'scripts/other.ts' })
      )
    ).toBeNull()
    expect(
      sameIssueScore(
        id(),
        id({ fingerprint: 'new', provenance: 'EXTERNAL_TOOL' })
      )
    ).toBeNull()
    expect(
      sameIssueScore(
        id({ provenance: 'DETERMINISTIC' }),
        id({ fingerprint: 'new' })
      )
    ).toBeNull()
  })

  it('across layers only with an overlapping class (the LUM-1200 notion)', () => {
    const vuln = id({
      ruleId: 'vuln:command_injection',
      title: 'Shell command injection via dir',
    })
    expect(
      sameIssueScore(
        vuln,
        id({
          fingerprint: 'new',
          ruleId: 'hunt:injection',
          title: 'dir reaches exec',
        })
      )
    ).not.toBeNull()
    expect(
      sameIssueScore(
        id({ ruleId: 'review:logic_error' }),
        id({ fingerprint: 'new', ruleId: 'hunt:injection' })
      )
    ).toBeNull()
  })
})

describe('sameIssueScore — broad hunt category (LUM-1200 follow-up)', () => {
  const judge = id({
    ruleId: 'vuln:weak_crypto',
    line: 14,
    title:
      'Session token generated with Math.random despite comment claiming CSPRNG',
    evidence: 'const token = Math.random().toString(36)',
  })
  it('hunt:logic one line away with a similar title is the same issue', () => {
    expect(
      sameIssueScore(
        judge,
        id({
          fingerprint: 'hunt',
          ruleId: 'hunt:logic',
          line: 13,
          title:
            'Session tokens use Math.random() instead of CSPRNG, allowing attackers to predict or enumerate valid session tokens with low entropy (~53 bits)',
          evidence: 'src/probe/session.ts#createSession',
        })
      )
    ).not.toBeNull()
  })
  // LUM-1200 follow-up #3 — across the two layers a related class within the
  // line window is enough; the title is no longer compared there.
  it('hunt:logic on the same line with an unrelated title is the same issue across layers', () => {
    expect(
      sameIssueScore(
        judge,
        id({
          fingerprint: 'hunt',
          ruleId: 'hunt:logic',
          line: 14,
          title: 'Refund endpoint skips the order state machine',
          evidence: null,
        })
      )
    ).not.toBeNull()
  })
})

// LUM-1200 follow-up #3 — production TC9 (lumo-agent-test#65 / #66): the
// hunt's long exploit claim one line from the AI review's short title shared
// about two words, so it opened its own thread and that thread was later
// marked addressed on the same head while the AI review still reported it.
describe('sameIssueScore — cross-layer pairs need no similar title (LUM-1200 follow-up #3)', () => {
  const judgeAuth = id({
    fingerprint: 'judge-auth',
    ruleId: 'vuln:auth_bypass',
    filePath: 'src/server.ts',
    line: 41,
    title: 'Unauthenticated session creation for any user name',
    evidence:
      "const s = createSession(url.searchParams.get('user') ?? '', now)",
  })
  const huntAuth = id({
    fingerprint: 'hunt-auth',
    ruleId: 'hunt:logic',
    filePath: 'src/server.ts',
    line: 42,
    title:
      'Sessions are created for any arbitrary username without authentication, allowing unauthorized access by specifying any username',
    evidence: null,
  })
  const judgeProto = id({
    fingerprint: 'judge-proto',
    ruleId: 'vuln:authz_logic',
    filePath: 'src/probe/order.ts',
    line: 7,
    title: 'Discount lookup on plain object reads prototype properties',
    evidence: 'const percent = DISCOUNTS[code];',
  })
  const huntProto = id({
    fingerprint: 'hunt-proto',
    ruleId: 'hunt:logic',
    filePath: 'src/probe/order.ts',
    line: 6,
    title:
      'Inherited property access in DISCOUNTS[code] lookup bypasses discount validation, allowing non-numeric truthy values to corrupt order total arithmetic',
    evidence: null,
  })

  it('the titles alone are not similar (the production shape)', () => {
    expect(titleSimilarity(judgeAuth.title, huntAuth.title)).toBeLessThan(0.5)
    expect(titleSimilarity(judgeProto.title, huntProto.title)).toBeLessThan(0.5)
  })

  it.each([
    ['#65 auth_bypass L41 / hunt L42', judgeAuth, huntAuth],
    ['#66 authz_logic L7 / hunt L6', judgeProto, huntProto],
    [
      'a broad class three lines away (the window edge)',
      id({ ...judgeAuth, ruleId: 'vuln:weak_crypto' }),
      { ...huntAuth, line: 44 },
    ],
  ])('%s is the same issue, in either direction', (_l, judge, hunt) => {
    expect(sameIssueScore(judge, hunt)).not.toBeNull()
    expect(sameIssueScore(hunt, judge)).not.toBeNull()
  })

  it.each([
    ['four lines away', { ...huntAuth, line: 45 }],
    [
      'another file',
      { ...huntAuth, filePath: 'src/services/session-store.ts' },
    ],
    ['an unrelated hunt class', { ...huntAuth, ruleId: 'hunt:ssrf' }],
    ['no line', { ...huntAuth, line: null, evidence: null }],
  ])('is not the same issue across %s', (_l, hunt) => {
    expect(sameIssueScore(judgeAuth, hunt)).toBeNull()
  })

  it('within one layer a nearby line still needs a similar title', () => {
    expect(
      sameIssueScore(judgeAuth, {
        ...judgeAuth,
        fingerprint: 'judge-other',
        ruleId: 'vuln:auth_bypass',
        line: 42,
        title: 'Session check accepts tokens from the query string',
        evidence: 'other',
      })
    ).toBeNull()
    expect(
      sameIssueScore(huntAuth, {
        ...huntAuth,
        fingerprint: 'hunt-other',
        line: 43,
        title: 'Refund endpoint skips the order state machine',
      })
    ).toBeNull()
  })

  it('holds on the stored (hashed) identities too', () => {
    const key = 'k'
    expect(
      sameIssueScore(
        hashIdentity(judgeProto, key),
        hashIdentity(huntProto, key)
      )
    ).not.toBeNull()
  })
})

describe('matchSuccessors', () => {
  it('pairs one-to-one, best match first, independent of input order', () => {
    const a = id({ fingerprint: 'a', line: 3 })
    const b = id({ fingerprint: 'b', line: 4, evidence: 'other' })
    const n = id({ fingerprint: 'n', ruleId: 'review:api_misuse', line: 3 })
    expect(matchSuccessors([a, b], [n])).toEqual(new Map([['a', 'n']]))
    expect(matchSuccessors([b, a], [n])).toEqual(new Map([['a', 'n']]))
  })

  it('never pairs a fingerprint with itself', () => {
    expect(matchSuccessors([id()], [id()])).toEqual(new Map())
  })
})

/**
 * LUM-1127 follow-up #2 — a thread row keeps its finding's identity as
 * keyed hashes (no code, no title); matching the hashed forms scores exactly
 * as matching the text.
 */
describe('hashed identity (stored on the thread row)', () => {
  const KEY = 'test-identity-key'
  const hashed = (f: FindingIdentity) => hashIdentity(f, KEY)

  it('evidenceHash normalises whitespace like the fingerprint; empty → null', () => {
    expect(evidenceHash('  return  JSON.parse(raw) ', KEY)).toBe(
      evidenceHash('return JSON.parse(raw)', KEY)
    )
    expect(evidenceHash('', KEY)).toBeNull()
    expect(evidenceHash(null, KEY)).toBeNull()
  })

  it('titleTokens: order-free, plural-folded, no plain words', () => {
    expect(titleTokens('errors swallowed', KEY)).toEqual(
      titleTokens('swallowed error', KEY)
    )
    expect(titleTokens('parseQuantity result', KEY).join(' ')).not.toMatch(
      /parse|result/
    )
    expect(titleTokens('the of', KEY)).toEqual([])
  })

  it('keyed: another key gives other hashes, and the key id tells them apart', () => {
    const a = titleTokens('session token', KEY)
    const b = titleTokens('session token', 'other-key')
    expect(a).not.toEqual(b)
    // A plain (unkeyed) hash of one word is not what is stored.
    expect(a.join(' ')).not.toContain(
      createHash('sha256').update('w:session').digest('hex').slice(0, 16)
    )
    const e = evidenceHash('return x', KEY)
    expect(isKeyedWith({ evidenceHash: e, titleTokens: a }, KEY)).toBe(true)
    expect(isKeyedWith({ evidenceHash: e, titleTokens: b }, KEY)).toBe(false)
    expect(isKeyedWith({ evidenceHash: null, titleTokens: [] }, KEY)).toBe(true)
    expect(identityKeyId(KEY)).not.toBe(identityKeyId('other-key'))
  })

  it.each([
    [
      'same evidence, new rule',
      id({ fingerprint: 'new', ruleId: 'review:api_misuse' }),
    ],
    [
      'one line apart, similar title',
      id({
        fingerprint: 'new',
        ruleId: 'review:logic_error',
        line: 4,
        evidence: 'other',
        title: 'console.log used in scripts folder',
      }),
    ],
    [
      'different issue',
      id({
        fingerprint: 'new',
        ruleId: 'review:error_handling',
        line: 9,
        evidence: 'await run(dir)',
        title: 'Rejected promise from run is never handled',
      }),
    ],
  ])('%s: hashed identities score as the plain ones', (_label, next) => {
    expect(sameIssueScore(hashed(id()), hashed(next))).toBe(
      sameIssueScore(id(), next)
    )
  })

  it('hashIdentity leaves an already-hashed identity as it is', () => {
    const h = hashed(id())
    expect(hashIdentity(h, KEY)).toBe(h)
  })

  it('PR 60: the relabelled parseQuantity finding continues the stored identity', () => {
    const prev = hashed(
      id({
        fingerprint: 'fp-data',
        ruleId: 'review:data_integrity',
        filePath: 'src/probe/session.ts',
        line: 30,
        title:
          'parseQuantity returns unvalidated JSON.parse result typed as number',
        evidence: 'return JSON.parse(raw)',
      })
    )
    const next = hashed(
      id({
        fingerprint: 'fp-logic',
        ruleId: 'review:logic_error',
        filePath: 'src/probe/session.ts',
        line: 31,
        title: 'parseQuantity returns unvalidated JSON.parse result',
        evidence: '  return JSON.parse(raw) as number',
      })
    )
    expect(matchSuccessors([prev], [next])).toEqual(
      new Map([['fp-data', 'fp-logic']])
    )
  })
})

describe('LUM-1127 follow-up #4 — identity history and the same line across rounds', () => {
  const KEY = 'k4'
  // Production, probe PR 67 `src/server.ts:31`.
  const r1 = id({
    ruleId: 'review:logic_error',
    filePath: 'src/server.ts',
    line: 31,
    title:
      'Session check route does not restrict method and prefix matching is loose',
    evidence: "if (req.url?.startsWith('/session/check')) {",
  })
  const r2 = {
    ...r1,
    title: 'Token in query string and route matching by prefix',
  }
  const r3 = id({
    ...r1,
    fingerprint: 'new',
    ruleId: 'review:api_misuse',
    title: 'Session check route ignores method and uses prefix match',
  })
  const variant = (f: FindingIdentity) => {
    const h = hashIdentity(f, KEY)
    return {
      ruleId: h.ruleId,
      line: h.line,
      evidenceHash: h.evidenceHash ?? null,
      titleTokens: h.titleTokens ?? [],
    }
  }

  it('r3 against r2 alone is not the same issue (different class, two shared words)', () => {
    expect(
      sameIssueScore(hashIdentity(r2, KEY), hashIdentity(r3, KEY))
    ).toBeNull()
  })

  it('…but the history holds r1, whose wording r3 shares: matched by the best score', () => {
    const thread = {
      ...hashIdentity(r2, KEY),
      history: [variant(r1), variant(r2)],
    }
    expect(sameIssueScore(thread, hashIdentity(r3, KEY))).not.toBeNull()
  })

  it('across rounds, the same layer on the same line is one issue whatever the class or title', () => {
    const next = id({
      ...r1,
      fingerprint: 'n',
      ruleId: 'review:performance',
      title: 'Inefficient lookup',
    })
    expect(sameIssueScore(r2, next)).toBeNull()
    expect(sameIssueScore(r2, next, { acrossRounds: true })).not.toBeNull()
    // Same quoted line, moved by an edit elsewhere.
    expect(
      sameIssueScore(r2, { ...next, line: 50 }, { acrossRounds: true })
    ).not.toBeNull()
  })

  it('…not when either side is crowded (two issues on that line in one round)', () => {
    const next = id({
      ...r1,
      fingerprint: 'n',
      ruleId: 'review:performance',
      title: 'Inefficient lookup',
    })
    expect(
      sameIssueScore({ ...r2, crowded: true }, next, { acrossRounds: true })
    ).toBeNull()
    expect(
      sameIssueScore(r2, { ...next, crowded: true }, { acrossRounds: true })
    ).toBeNull()
    // The title / class rules still apply when crowded.
    expect(
      sameIssueScore(
        { ...r1, crowded: true },
        { ...r3, crowded: true },
        { acrossRounds: true }
      )
    ).not.toBeNull()
  })

  it('the same line number quoting other code (the line was rewritten) is not the same code for the rule', () => {
    const next = id({
      ...r1,
      fingerprint: 'n',
      ruleId: 'review:performance',
      title: 'Inefficient lookup',
      evidence: 'const cache = new Map()',
    })
    expect(sameIssueScore(r2, next, { acrossRounds: true })).toBeNull()
    // Quote unknown on one side: the line decides.
    expect(
      sameIssueScore(r2, { ...next, evidence: null }, { acrossRounds: true })
    ).not.toBeNull()
  })

  it('a crowded variant in the history turns the same-line rule off on its own', () => {
    const next = id({
      ...r1,
      fingerprint: 'n',
      ruleId: 'review:performance',
      title: 'Inefficient lookup',
    })
    const plain = { ...hashIdentity(r2, KEY), line: 99, evidenceHash: null }
    const v = { ...variant(r2), crowded: true }
    expect(
      sameIssueScore({ ...plain, history: [v] }, hashIdentity(next, KEY), {
        acrossRounds: true,
      })
    ).toBeNull()
    expect(
      sameIssueScore(
        { ...plain, history: [variant(r2)] },
        hashIdentity(next, KEY),
        { acrossRounds: true }
      )
    ).not.toBeNull()
  })

  it('…never across layers on the line alone, nor within ±3 lines without a title or class', () => {
    const hunt = id({
      ...r1,
      fingerprint: 'h',
      ruleId: 'hunt:injection',
      title: 'x',
    })
    expect(sameIssueScore(r2, hunt, { acrossRounds: true })).toBeNull()
    const near = id({
      ...r1,
      fingerprint: 'n',
      ruleId: 'review:performance',
      line: 33,
      title: 'Inefficient lookup',
      evidence: 'res.end(body)',
    })
    expect(sameIssueScore(r2, near, { acrossRounds: true })).toBeNull()
  })

  it('matchSuccessors passes the option through', () => {
    const next = id({
      ...r1,
      fingerprint: 'n',
      ruleId: 'review:performance',
      title: 'Inefficient lookup',
    })
    expect(matchSuccessors([r2], [next]).size).toBe(0)
    expect(matchSuccessors([r2], [next], { acrossRounds: true })).toEqual(
      new Map([['old', 'n']])
    )
  })

  it('crowdedFingerprints: same layer, file and line only', () => {
    const f = (
      fingerprint: string,
      ruleId: string,
      line: number | null,
      filePath = 'a.ts'
    ) => ({
      fingerprint,
      ruleId,
      provenance: 'LLM_JUDGE' as const,
      filePath,
      line,
    })
    expect(
      crowdedFingerprints([
        f('a', 'review:logic_error', 3),
        f('b', 'review:api_misuse', 3),
        f('c', 'hunt:logic', 3),
        f('d', 'review:logic_error', 3, 'b.ts'),
        f('e', 'review:logic_error', null),
        f('g', 'review:logic_error', null),
        { ...f('s', 'secret:aws', 3), provenance: 'DETERMINISTIC' as const },
      ])
    ).toEqual(new Set(['a', 'b']))
  })
})
