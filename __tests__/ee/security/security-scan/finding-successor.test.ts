/**
 * LUM-1127 follow-up — the rule-id-tolerant same-issue match that keeps a
 * thread open when the AI review reports the same issue under a new
 * fingerprint (prod probe PR 52: `review:doc_mismatch` → `review:api_misuse`).
 */
import {
  evidenceHash,
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
 * hashes (no code); matching against the hashed form scores exactly as
 * against the text.
 */
describe('hashed identity (stored on the thread row)', () => {
  const hashed = (f: FindingIdentity): FindingIdentity => ({
    ...f,
    title: '',
    evidence: null,
    evidenceHash: evidenceHash(f.evidence),
    titleTokens: titleTokens(f.title),
  })

  it('evidenceHash normalises whitespace like the fingerprint; empty → null', () => {
    expect(evidenceHash('  return  JSON.parse(raw) ')).toBe(
      evidenceHash('return JSON.parse(raw)')
    )
    expect(evidenceHash('')).toBeNull()
    expect(evidenceHash(null)).toBeNull()
  })

  it('titleTokens: order-free, plural-folded, no plain words', () => {
    expect(titleTokens('errors swallowed')).toEqual(
      titleTokens('swallowed error')
    )
    expect(titleTokens('parseQuantity result').join(' ')).not.toMatch(
      /parse|result/
    )
    expect(titleTokens('the of')).toEqual([])
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
  ])('%s: the hashed previous scores as the plain one', (_label, next) => {
    expect(sameIssueScore(hashed(id()), next)).toBe(sameIssueScore(id(), next))
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
    const next = id({
      fingerprint: 'fp-logic',
      ruleId: 'review:logic_error',
      filePath: 'src/probe/session.ts',
      line: 31,
      title: 'parseQuantity returns unvalidated JSON.parse result',
      evidence: '  return JSON.parse(raw) as number',
    })
    expect(matchSuccessors([prev], [next])).toEqual(
      new Map([['fp-data', 'fp-logic']])
    )
  })
})
