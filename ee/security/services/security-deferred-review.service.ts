/**
 * LUM-1152 follow-up — a manual review that arrived while its head's scan was
 * still in flight waits for it (lib/workflows/security-deferred-review.ts).
 */
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { logger } from '@/lib/logger'
import {
  deferredReviewDecision,
  type DeferredReviewDecision,
} from '@/ee/security/security-scan/review-control'
import { dispatchPrSecurityScan } from './pr-security-scan-dispatch'

export const deferredReviewService = {
  /** What to do with the scan the review waited on (review-control.ts). */
  async decide(scanId: string): Promise<DeferredReviewDecision> {
    const row = await prSecurityScanRepository.findManualRestartState(scanId)
    return deferredReviewDecision(row)
  },

  /** The wait ran out: said in the log, the user can ask again. */
  giveUp(scanId: string, reviewMode: 'incremental' | 'full'): void {
    logger.warn(
      `[pr-security-scan] deferred manual ${reviewMode} review gave up scan=${scanId}: the scan did not settle in time`
    )
  },

  async dispatch(
    pullRequestId: string,
    reviewMode: 'incremental' | 'full'
  ): Promise<void> {
    await dispatchPrSecurityScan(pullRequestId, 'PR_EVENT', reviewMode, {
      deferred: true,
    })
  },
}
