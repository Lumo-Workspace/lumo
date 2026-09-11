import { getRun, start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { lumoCiWorkflow } from '@/lib/workflows/lumo-ci'
import type { LumoCiJob } from './lumo-ci.config'

/**
 * LUM-746 — the two `workflow/api` touch points of the managed CI, both
 * never-throw: the request path stamps the row FAILED on a null start, and a
 * cancel that fails only costs money (the VM is stopped by tag separately).
 */
export async function startLumoCi(job: LumoCiJob): Promise<string | null> {
  try {
    const run = await start(lumoCiWorkflow, [job])
    logger.info(
      `[lumo-ci] started workflow=${run.runId} run=${job.ciRunId} ${job.repo}#${job.prNumber}`
    )
    return run.runId
  } catch (error) {
    logger.error(
      `[lumo-ci] start failed run=${job.ciRunId} ${job.repo}#${job.prNumber}:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

export async function cancelLumoCiRun(
  runId: string,
  ciRunId: string
): Promise<boolean> {
  try {
    await getRun(runId).cancel()
    logger.info(`[lumo-ci] cancelled run=${runId} ci=${ciRunId}`)
    return true
  } catch (error) {
    logger.warn(
      `[lumo-ci] cancel failed run=${runId} ci=${ciRunId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return false
  }
}
