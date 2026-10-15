/**
 * LUM-1152 follow-up — a manual review that arrived while its head's scan was
 * still in flight waits for it (lib/workflows/security-deferred-review.ts).
 */
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { isSettledForManualReview } from '@/ee/security/security-scan/review-control'
import { dispatchPrSecurityScan } from './pr-security-scan-dispatch'

export const deferredReviewService = {
  /** A missing row counts as settled: dispatching then makes a fresh scan. */
  async isScanSettled(scanId: string): Promise<boolean> {
    const row = await prSecurityScanRepository.findManualRestartState(scanId)
    return row === null || isSettledForManualReview(row)
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
