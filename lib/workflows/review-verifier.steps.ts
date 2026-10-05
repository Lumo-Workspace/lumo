/**
 * LUM-988 — the agentic verifier's `'use step'`. One step: the service never
 * throws (it always stamps `verifiedAt` and syncs), so the default retry
 * policy only re-runs a step the platform itself lost.
 */
import {
  reviewVerifierService,
  type ReviewVerifierJob,
  type ReviewVerifierOutcome,
} from '@/lib/services/review-verifier.service'

export async function verifyReviewFindingsStep(
  job: ReviewVerifierJob
): Promise<ReviewVerifierOutcome> {
  'use step'
  return reviewVerifierService.run(job)
}
