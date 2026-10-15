/**
 * LUM-1127 follow-up — the rule-id-tolerant same-issue match that keeps a
 * thread open when the AI review reports the same issue under a new
 * fingerprint (prod probe PR 52: `review:doc_mismatch` → `review:api_misuse`).
 */
import {
  matchSuccessors,
  sameIssueScore,
  titleSimilarity,
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
