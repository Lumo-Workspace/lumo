import { start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { securityHuntWorkflow } from '@/lib/workflows/security-hunt'
import type { HuntJob } from './security-hunt.config'

/** Never throws: stage A stamps `hunt=FAILED` on a null. Logs no sha. */
export async function startSecurityHunt(job: HuntJob): Promise<string | null> {
  try {
    const run = await start(securityHuntWorkflow, [job])
    logger.info(
      `[security-hunt] started run=${run.runId} scan=${job.scanId} ${job.repo}#${job.prNumber}`
    )
    return run.runId
  } catch (error) {
    logger.error(
      `[security-hunt] start failed scan=${job.scanId} ${job.repo}#${job.prNumber}:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}
