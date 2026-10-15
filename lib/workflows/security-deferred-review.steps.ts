/**
 * LUM-1152 follow-up — `'use step'` boundaries for the deferred manual
 * review. One-line delegates; the logic lives in the service.
 */
import { deferredReviewService } from '@/ee/security/services/security-deferred-review.service'

export async function isScanSettledStep(scanId: string): Promise<boolean> {
  'use step'
  return deferredReviewService.isScanSettled(scanId)
}

export async function dispatchDeferredReviewStep(
  pullRequestId: string,
  reviewMode: 'incremental' | 'full'
): Promise<void> {
  'use step'
  await deferredReviewService.dispatch(pullRequestId, reviewMode)
}
