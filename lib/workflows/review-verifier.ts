/**
 * LUM-988 — the agentic verifier as a workflow: stage A's function has no
 * time left to wait for the managed scan's VM, so it starts this run and
 * returns. Deterministic body; all I/O is in the step.
 */
import type {
  ReviewVerifierJob,
  ReviewVerifierOutcome,
} from '@/lib/services/review-verifier.service'
import { verifyReviewFindingsStep } from './review-verifier.steps'

export async function reviewVerifierWorkflow(
  job: ReviewVerifierJob
): Promise<ReviewVerifierOutcome> {
  'use workflow'
  return verifyReviewFindingsStep(job)
}
