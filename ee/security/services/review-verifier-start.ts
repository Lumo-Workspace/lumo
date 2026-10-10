import { start } from 'workflow/api'
import { logger } from '@/lib/logger'
import {
  isIntegrationConfigured,
  SANDBOX_NOT_CONFIGURED,
} from '@/lib/integrations/configured'
import { reviewVerifierWorkflow } from '@/lib/workflows/review-verifier'
import type { ReviewVerifierJob } from './review-verifier.service'

/**
 * LUM-988 — start the verifier workflow. Never throws; false = not started,
 * and stage A then releases the hold itself so nothing waits for a run that
 * does not exist.
 */
export async function startReviewVerifier(
  job: ReviewVerifierJob
): Promise<boolean> {
  if (!isIntegrationConfigured('vercelSandbox')) {
    logger.info(
      `[review-verifier] skipped scan=${job.scanId} ${job.repo}#${job.prNumber}: ${SANDBOX_NOT_CONFIGURED}`
    )
    return false
  }
  try {
    const run = await start(reviewVerifierWorkflow, [job])
    logger.info(
      `[review-verifier] started run=${run.runId} scan=${job.scanId} ${job.repo}#${job.prNumber}`
    )
    return true
  } catch (error) {
    logger.error(
      `[review-verifier] start failed scan=${job.scanId} ${job.repo}#${job.prNumber}:`,
      error instanceof Error ? error.message : String(error)
    )
    return false
  }
}
