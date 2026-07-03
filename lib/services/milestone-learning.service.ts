import { milestoneMemoryEdgeRepository } from '@/lib/repositories/milestone-memory-edge.repository'

/**
 * Minimum number of JUDGED edges (used=true + used=false) before a usage rate
 * is reported. Below it the read-out says `insufficient` rather than fabricate
 * a misleading percentage from a thin sample — the same honesty口径 as the
 * judged-used trust ladder (RFC LUM-535): abstentions never fill the gap.
 */
export const LEARNING_MIN_JUDGED = 3

export interface CrossMilestoneUsage {
  /** All prior-milestone memories injected into this milestone's stewards. */
  injected: number
  /** Edges with a verdict (used=true or used=false) — the rate's denominator. */
  judged: number
  /** used=true. */
  judgedUsed: number
  /** used=null: injected but not yet audited / judge abstained. Excluded from
   *  the denominator (弃权≠负证据). */
  abstained: number
  /** Distinct prior milestones the injected learning came from. */
  sourceMilestones: number
  /**
   * judgedUsed / judged — the cross-milestone learning-migration usage rate.
   * A LOWER BOUND (abstentions are not counted against it) and `null`
   * (insufficient) until `judged` reaches `LEARNING_MIN_JUDGED`.
   */
  rate: number | null
}

/**
 * LUM-648: the cross-milestone learning-migration read-out — how much of the
 * learning distilled from earlier milestones was actually used by a later
 * milestone's steward sessions. Reads the usage-vote substrate
 * (`MilestoneMemoryEdge`) filled by the injection birth + milestone-close audit.
 */
export const milestoneLearningService = {
  async getCrossMilestoneUsage(
    milestoneId: string
  ): Promise<CrossMilestoneUsage> {
    const agg = await milestoneMemoryEdgeRepository.aggregateUsage(milestoneId)
    // Denominator excludes abstentions (used=null): an un-audited / abstained
    // edge is not evidence of non-use, so it must not drag the rate down.
    const judged = agg.judgedUsed + agg.judgedUnused
    const rate = judged >= LEARNING_MIN_JUDGED ? agg.judgedUsed / judged : null
    return {
      injected: agg.injected,
      judged,
      judgedUsed: agg.judgedUsed,
      abstained: agg.abstained,
      sourceMilestones: agg.sourceMilestones,
      rate,
    }
  },
}
