import { outcomeRejectionRepository } from '@/lib/repositories/outcome-rejection.repository'
import {
  computeOutcomeRejectionRate,
  type DeliveryOutcome,
  type OutcomeRejectionReport,
} from '@/lib/outcome/rejection-rate'

/**
 * LUM-603 / LUM-606 — orchestrates the trust × post-hoc-fate read.
 *
 * Loads the joined deliveries (frozen forecast snapshot × outcome-signal count)
 * and hands them to the pure {@link computeOutcomeRejectionRate} core. The trust
 * bracket is derived ONLY from the frozen verification-friction scalars
 * (verificationRounds / sendBackCount, LUM-606) — this service reads no
 * live/current or fragment trust value.
 *
 * Today the well is freshly wired and under-sampled, so the report is honestly
 * `inconclusive` with thin per-bracket Ns; the same code produces real strata
 * once signals accumulate (the deferred PENDING_OUTCOME the task is built for).
 */
export const outcomeRejectionService = {
  async getOutcomeRejectionRate(
    workspaceId: string,
    options: { minSamples?: number } = {}
  ): Promise<OutcomeRejectionReport> {
    const rows =
      await outcomeRejectionRepository.listDeliveriesWithRejection(workspaceId)
    const deliveries: DeliveryOutcome[] = rows.map(r => ({
      // Frozen-at-delivery friction scalars — the replayable trust axis.
      verificationRounds: r.verificationRounds,
      sendBackCount: r.sendBackCount,
      // Falsifier verdict reduced to a boolean: any signal ⇒ REJECTED.
      rejected: r.signalCount > 0,
    }))
    return computeOutcomeRejectionRate(deliveries, options)
  },
}
