/** @jest-environment node */

const mockAggregateUsage = jest.fn()
jest.mock('@/lib/repositories/milestone-memory-edge.repository', () => ({
  milestoneMemoryEdgeRepository: {
    aggregateUsage: (...a: any[]) => mockAggregateUsage(...a),
  },
}))

import {
  milestoneLearningService,
  LEARNING_MIN_JUDGED,
} from '@/lib/services/milestone-learning.service'

beforeEach(() => jest.clearAllMocks())

describe('milestoneLearningService.getCrossMilestoneUsage (LUM-648)', () => {
  it('computes cross milestone usage rate excluding abstentions and reports insufficient below threshold', async () => {
    // 10 injected: 6 used, 2 judged-unused, 2 abstained. The rate divides by
    // JUDGED (8) — the 2 abstentions are excluded from the denominator, so the
    // rate is 6/8 = 0.75, not 6/10.
    mockAggregateUsage.mockResolvedValueOnce({
      injected: 10,
      judgedUsed: 6,
      judgedUnused: 2,
      abstained: 2,
      sourceMilestones: 2,
    })
    const ample = await milestoneLearningService.getCrossMilestoneUsage('ms1')
    expect(ample).toEqual({
      injected: 10,
      judged: 8,
      judgedUsed: 6,
      abstained: 2,
      sourceMilestones: 2,
      rate: 0.75,
    })

    // Thin sample: only 2 judged edges (< LEARNING_MIN_JUDGED). No fabricated
    // percentage — rate is null (the read-out prints `insufficient`), even
    // though there are plenty of abstained impressions.
    expect(LEARNING_MIN_JUDGED).toBe(3)
    mockAggregateUsage.mockResolvedValueOnce({
      injected: 7,
      judgedUsed: 1,
      judgedUnused: 1,
      abstained: 5,
      sourceMilestones: 1,
    })
    const thin = await milestoneLearningService.getCrossMilestoneUsage('ms2')
    expect(thin.judged).toBe(2)
    expect(thin.rate).toBeNull()

    // Exactly at the threshold: reported.
    mockAggregateUsage.mockResolvedValueOnce({
      injected: 3,
      judgedUsed: 3,
      judgedUnused: 0,
      abstained: 0,
      sourceMilestones: 1,
    })
    const atThreshold =
      await milestoneLearningService.getCrossMilestoneUsage('ms3')
    expect(atThreshold.judged).toBe(3)
    expect(atThreshold.rate).toBe(1)
  })

  it('reports zeros with null rate when nothing was injected', async () => {
    mockAggregateUsage.mockResolvedValueOnce({
      injected: 0,
      judgedUsed: 0,
      judgedUnused: 0,
      abstained: 0,
      sourceMilestones: 0,
    })
    const empty = await milestoneLearningService.getCrossMilestoneUsage('ms0')
    expect(empty).toEqual({
      injected: 0,
      judged: 0,
      judgedUsed: 0,
      abstained: 0,
      sourceMilestones: 0,
      rate: null,
    })
  })
})
