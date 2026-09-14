/**
 * @jest-environment node
 *
 * LUM-771 — a Write (no before-side) to a checkpointer-dependent test file can
 * never be pre-filter-classified LEGIT. `assertionsWeakened` cannot diff a Write
 * (nothing to compare against), so "not weakened" carries no evidence; the only
 * honest Stage-1 answer is AMBIGUOUS, handing the edit to Stage-2 review. Before
 * this fix a full-file rewrite that deleted half the tests was auto-LEGIT the
 * moment any production file co-changed.
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { classifyTestTamperingPrefilter } from '@/lib/boundary-crossing/test-tampering-prefilter'

describe('LUM-771 Write never prefilters to LEGIT', () => {
  const rewrittenTestFile = [
    "import { sum } from '@/lib/sum'",
    "it('adds', () => { expect(sum(1, 2)).toBe(3) })",
  ].join('\n')

  it('lands in AMBIGUOUS even when production code co-changed', () => {
    expect(
      classifyTestTamperingPrefilter({
        oldString: null,
        newString: rewrittenTestFile,
        productionCodeCoChanged: true,
        backingCriterionChanged: false,
      })
    ).toBe('AMBIGUOUS')
  })

  it('lands in AMBIGUOUS even when the backing criterion was edited', () => {
    expect(
      classifyTestTamperingPrefilter({
        oldString: null,
        newString: rewrittenTestFile,
        productionCodeCoChanged: null,
        backingCriterionChanged: true,
      })
    ).toBe('AMBIGUOUS')
  })

  it('still classifies a diffable, non-weakening Edit with a co-change as LEGIT', () => {
    expect(
      classifyTestTamperingPrefilter({
        oldString: "it('adds', () => { expect(sum(1, 2)).toBe(3) })",
        newString: "it('adds', () => { expect(sum(1, 2)).toBe(4) })",
        productionCodeCoChanged: true,
        backingCriterionChanged: false,
      })
    ).toBe('LEGIT')
  })
})
