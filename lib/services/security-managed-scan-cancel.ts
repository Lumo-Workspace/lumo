import { getRun } from 'workflow/api'
import { logger } from '@/lib/logger'

/**
 * LUM-745 — cancel a managed-scan workflow run stage A no longer wants: the
 * PR moved to a newer head (supersede) or the run never reported (sweep).
 * Never throws — the caller has already stamped the row, and a cancel that
 * fails only costs money, never correctness. Cancelling stops further
 * steps; the in-flight sandbox is stopped separately by tag
 * (`stopRepoSandboxesByTag`), and the step's entry guard makes a retry
 * after this call a no-op.
 */
export async function cancelManagedRun(
  runId: string,
  scanId: string
): Promise<boolean> {
  try {
    await getRun(runId).cancel()
    logger.info(`[security-managed-scan] cancelled run=${runId} scan=${scanId}`)
    return true
  } catch (error) {
    logger.warn(
      `[security-managed-scan] cancel failed run=${runId} scan=${scanId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return false
  }
}
