import { getRun, start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
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

/**
 * LUM-822 — keep the job stage A started, so the stale-hunt sweep can retry
 * it. Never throws: a missed write only costs that retry (a row without a
 * job is failed by the sweep instead of restarted), never the scan.
 */
export async function recordHuntStartBestEffort(
  scanId: string,
  job: HuntJob,
  runId: string
): Promise<void> {
  try {
    await prSecurityScanRepository.recordHuntStart(scanId, {
      job: { ...job },
      runId,
      attempt: job.attempt ?? 1,
    })
  } catch (error) {
    logger.warn(
      `[security-hunt] start record failed scan=${scanId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

/** LUM-822 — cancel a hunt run the stale-hunt sweep gave up on. Never throws. */
export async function cancelHuntRun(
  runId: string,
  scanId: string
): Promise<boolean> {
  try {
    await getRun(runId).cancel()
    logger.info(`[security-hunt] cancelled run=${runId} scan=${scanId}`)
    return true
  } catch (error) {
    logger.warn(
      `[security-hunt] cancel failed run=${runId} scan=${scanId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return false
  }
}
