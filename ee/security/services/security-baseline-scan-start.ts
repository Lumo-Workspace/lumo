import { start } from 'workflow/api'
import { logger } from '@/lib/logger'
import {
  isIntegrationConfigured,
  SANDBOX_NOT_CONFIGURED,
} from '@/lib/integrations/configured'
import { securityBaselineScanWorkflow } from '@/lib/workflows/security-baseline-scan'
import type { BaselineScanJob } from './security-managed-scan.config'

/** LUM-738 — never throws: the caller leaves the claim unwritten on a null. */
export async function startSecurityBaselineScan(
  job: BaselineScanJob
): Promise<string | null> {
  if (!isIntegrationConfigured('vercelSandbox')) {
    logger.info(
      `[security-baseline] skipped ${job.repo}@${job.sha.slice(0, 7)}: ${SANDBOX_NOT_CONFIGURED}`
    )
    return null
  }
  try {
    const run = await start(securityBaselineScanWorkflow, [job])
    logger.info(
      `[security-baseline] started run=${run.runId} ${job.repo}@${job.sha.slice(0, 7)}`
    )
    return run.runId
  } catch (error) {
    logger.error(
      `[security-baseline] start failed ${job.repo}@${job.sha.slice(0, 7)}:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}
