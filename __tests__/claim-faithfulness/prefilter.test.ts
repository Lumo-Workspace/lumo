/** @jest-environment node */
import { prefilterUnderreport } from '@/lib/claim-faithfulness/prefilter'

const churn = { additions: 80, deletions: 10, changedFiles: ['lib/a.ts'] }

describe('prefilterUnderreport', () => {
  it('flags a negative-delivery claim against a substantive diff', () => {
    expect(prefilterUnderreport('本次未包含代码变更', churn)).toBe(
      'UNDERREPORT_CANDIDATE'
    )
    expect(prefilterUnderreport('investigation into the bug only', churn)).toBe(
      'UNDERREPORT_CANDIDATE'
    )
    expect(prefilterUnderreport('no code changes were made', churn)).toBe(
      'UNDERREPORT_CANDIDATE'
    )
  })
  it('does not flag a substantive claim', () => {
    expect(
      prefilterUnderreport('refactored the resolver and added tests', churn)
    ).toBeNull()
  })
  it('does not flag when the diff is trivial', () => {
    expect(
      prefilterUnderreport('未改代码', {
        additions: 1,
        deletions: 0,
        changedFiles: ['README.md'],
      })
    ).toBeNull()
  })
  it('returns null for an absent claim', () => {
    expect(prefilterUnderreport(null, churn)).toBeNull()
  })
})
