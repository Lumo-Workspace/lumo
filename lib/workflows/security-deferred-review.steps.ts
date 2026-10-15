/**
 * LUM-1152 follow-up — `'use step'` boundaries for the deferred manual
 * review. One-line delegates; the logic lives in the service.
 */
import { deferredReviewService } from '@/ee/security/services/security-deferred-review.service'
import type { DeferredReviewDecision } from '@/ee/security/security-scan/review-control'

export async function decideDeferredReviewStep(
  scanId: string
): Promise<DeferredReviewDecision> {
  'use step'
  return deferredReviewService.decide(scanId)
}

export async function dispatchDeferredReviewStep(
  pullRequestId: string,
  reviewMode: 'incremental' | 'full'
): Promise<void> {
  'use step'
  await deferredReviewService.dispatch(pullRequestId, reviewMode)
}

export async function giveUpDeferredReviewStep(
  scanId: string,
  reviewMode: 'incremental' | 'full'
): Promise<void> {
  'use step'
  deferredReviewService.giveUp(scanId, reviewMode)
}
