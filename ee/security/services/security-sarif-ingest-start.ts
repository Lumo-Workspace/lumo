/**
 * LUM-735 v4 — starts one durable ingest run per pushed report. Replaces the
 * self-call dispatcher: `start()` enqueues on Vercel Workflows and returns
 * as soon as the run is persisted (rate limits are retried inside the SDK).
 * Never throws — a report whose run could not be started is logged with its
 * tool/repo/PR (never the blob URL) and the caller decides how to answer.
 */
import { start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { securitySarifIngestWorkflow } from '@/lib/workflows/security-sarif-ingest'
import type { SarifIngestJob } from './security-sarif-ingest.service'

export type { SarifIngestJob } from './security-sarif-ingest.service'

export async function startSecuritySarifIngest(
  job: SarifIngestJob
): Promise<string | null> {
  try {
    const run = await start(securitySarifIngestWorkflow, [job])
    logger.info(
      `[security-sarif-ingest] started run=${run.runId} tool=${job.tool} ${job.repository}#${job.prNumber}`
    )
    return run.runId
  } catch (error) {
    logger.error(
      `[security-sarif-ingest] start failed tool=${job.tool} ${job.repository}#${job.prNumber}:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}
