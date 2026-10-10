/**
 * @jest-environment node
 *
 * LUM-1064: plugin half of __tests__/boundary-auto-suppressed.test.ts (split)
 * — the case on the private false-positive-rate report (crossing eval).
 *
 * LUM-751 — AUTO_SUPPRESSED rows are counted apart from the human
 * false-positive rate.
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { computeFalsePositiveRates } from '@/ee/private/boundary-crossing/false-positive-rate'

describe('LUM-751 — AUTO_SUPPRESSED by repository rule', () => {
  it('AUTO_SUPPRESSED rows are counted apart from the human false-positive rate', () => {
    const report = computeFalsePositiveRates(
      [
        { category: 'NEW_NPM_DEPENDENCY', disposition: 'AUTO_SUPPRESSED' },
        { category: 'NEW_NPM_DEPENDENCY', disposition: 'AUTO_SUPPRESSED' },
      ],
      { minSamples: 1 }
    )
    expect(report.categories[0]!.autoSuppressed).toBe(2)
    expect(report.categories[0]!.dispositioned).toBe(0)
    expect(report.categories[0]!.status).toBe('insufficient')
  })
})
