import { start } from 'workflow/api'
import { logger } from '@/lib/logger'
import {
  securityDeferredReviewWorkflow,
  type DeferredReviewJob,
} from '@/lib/workflows/security-deferred-review'

/**
 * LUM-1152 follow-up — start the wait for a manual review whose head's scan
 * is still in flight. Never throws: false = it could not be deferred (logged).
 */
export async function startDeferredManualReview(
  job: DeferredReviewJob
): Promise<boolean> {
  try {
    const run = await start(securityDeferredReviewWorkflow, [job])
    logger.info(
      `[pr-security-scan] manual ${job.reviewMode} review deferred run=${run.runId} scan=${job.scanId}: the head's scan is still in flight`
    )
    return true
  } catch (error) {
    logger.error(
      `[pr-security-scan] manual review defer failed scan=${job.scanId}:`,
      error instanceof Error ? error.message : String(error)
    )
    return false
  }
}
