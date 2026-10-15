/**
 * LUM-1152 follow-up — a manual review (`@<app> review`, `lumo pr scan
 * --review`) asked for while the head's scan is still in flight (its managed
 * scanners, hunt or verifier running) used to be deduplicated onto that scan.
 * When that scan's AI layers were held — the description's `@<app> ignore`,
 * a pause, the hourly cap — the review the user asked for never ran.
 *
 * This run waits for the scan to settle, then dispatches the manual review
 * once — unless the scan's own AI review ran after all and is the review
 * asked for (a full request needs a full review; a repeated request while
 * one runs deduplicates). Bounded: it gives up after DEFERRED_REVIEW_MAX_WAITS (a scan stuck
 * past that is failed by the stale sweep, and the user can ask again). The
 * dispatched review is marked `deferred`, so a race that finds the scan in
 * flight again deduplicates instead of starting another wait.
 */
import { sleep } from 'workflow'
import {
  decideDeferredReviewStep,
  dispatchDeferredReviewStep,
  giveUpDeferredReviewStep,
} from './security-deferred-review.steps'

export const DEFERRED_REVIEW_INTERVAL = '30s'
export const DEFERRED_REVIEW_MAX_WAITS = 20

export interface DeferredReviewJob {
  pullRequestId: string
  scanId: string
  reviewMode: 'incremental' | 'full'
}

export type DeferredReviewOutcome =
  | { outcome: 'DISPATCHED'; waits: number }
  | { outcome: 'COVERED'; waits: number }
  | { outcome: 'GAVE_UP'; waits: number }

export async function securityDeferredReviewWorkflow(
  job: DeferredReviewJob
): Promise<DeferredReviewOutcome> {
  'use workflow'

  for (let waits = 1; waits <= DEFERRED_REVIEW_MAX_WAITS; waits++) {
    await sleep(DEFERRED_REVIEW_INTERVAL)
    const decision = await decideDeferredReviewStep(job.scanId, job.reviewMode)
    if (decision === 'covered') return { outcome: 'COVERED', waits }
    if (decision === 'dispatch') {
      await dispatchDeferredReviewStep(job.pullRequestId, job.reviewMode)
      return { outcome: 'DISPATCHED', waits }
    }
  }
  await giveUpDeferredReviewStep(job.scanId, job.reviewMode)
  return { outcome: 'GAVE_UP', waits: DEFERRED_REVIEW_MAX_WAITS }
}
