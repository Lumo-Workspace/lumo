/**
 * LUM-735 Task 2 — the `'use step'` boundary for the PR write-back, so both
 * workflows can post their findings back to the pull request without doing I/O
 * in their (deterministic) bodies.
 *
 * The service never throws, so this step never fails a run and needs no
 * best-effort wrapper of its own.
 */
import { securityPrReviewService } from '@/lib/services/security-pr-review.service'

export async function syncPrReviewStep(scanId: string): Promise<void> {
  'use step'
  await securityPrReviewService.sync(scanId)
}
