/** @jest-environment node */
import {
  findingCountPhrase,
  isCodeReviewFinding,
  isRewardHackFinding,
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

describe('LUM-1234 agent-behavior findings are not security findings', () => {
  it('recognises reward-hack/<KIND> rule ids only', () => {
    expect(isRewardHackFinding('reward-hack/TEST_TAMPERING')).toBe(true)
    expect(isRewardHackFinding('review:logic_error')).toBe(false)
    expect(isRewardHackFinding('vuln:xss')).toBe(false)
  })

  it('counts them apart from security findings and bugs', () => {
    expect(findingCountPhrase(['reward-hack/OTHER'])).toBe(
      '1 agent-behavior finding'
    )
    expect(
      findingCountPhrase([
        'vuln:xss',
        'review:a',
        'reward-hack/OTHER',
        'reward-hack/OVERCLAIM',
      ])
    ).toBe('1 security finding · 1 bug · 2 agent-behavior findings')
  })
})
