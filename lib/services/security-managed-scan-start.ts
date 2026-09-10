import { start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { securityManagedScanWorkflow } from '@/lib/workflows/security-managed-scan'
import type { ManagedScanJob } from './security-managed-scan.config'

/** Never throws: stage A stamps `external=FAILED` on a null. */
export async function startSecurityManagedScan(
  job: ManagedScanJob
): Promise<string | null> {
  try {
    const run = await start(securityManagedScanWorkflow, [job])
    logger.info(
      `[security-managed-scan] started run=${run.runId} scan=${job.scanId} ${job.pr.repo}#${job.pr.number}`
    )
    return run.runId
  } catch (error) {
    logger.error(
      `[security-managed-scan] start failed scan=${job.scanId} ${job.pr.repo}#${job.pr.number}:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}
