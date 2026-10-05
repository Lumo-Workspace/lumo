/** @jest-environment node */
import {
  findingCountPhrase,
  isCodeReviewFinding,
} from '@/shared/src/security-scan'

describe('LUM-988 code-review findings vs security findings', () => {
  it('recognises review:<kind> rule ids only', () => {
    expect(isCodeReviewFinding('review:logic_error')).toBe(true)
    for (const r of [
      'vuln:xss',
      'secret:aws',
      'ext:semgrep:x',
      'graph:llm-output-to-sink',
    ])
      expect([r, isCodeReviewFinding(r)]).toEqual([r, false])
  })

  it('phrases the counts split by kind', () => {
    expect(findingCountPhrase(['vuln:xss'])).toBe('1 security finding')
    expect(findingCountPhrase(['vuln:xss', 'secret:a'])).toBe(
      '2 security findings'
    )
    expect(findingCountPhrase(['review:logic_error'])).toBe('1 bug')
    expect(findingCountPhrase(['vuln:xss', 'review:a', 'review:b'])).toBe(
      '1 security finding · 2 bugs'
    )
    expect(findingCountPhrase([])).toBe('0 security findings')
  })
})
