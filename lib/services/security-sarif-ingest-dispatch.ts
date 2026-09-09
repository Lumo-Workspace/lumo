/**
 * Dispatch helper for the SARIF ingest worker (LUM-735).
 *
 * Mirrors lib/services/pr-security-scan-dispatch.ts exactly:
 * - NO gateway / LLM imports (safe to import statically from the internal
 *   route built in Task 8).
 * - Best-effort: failures are logged and swallowed — never throws, so a
 *   dispatch call can never fail the request that triggered it.
 */
import { logger } from '@/lib/logger'
import type { SarifIngestJob } from './security-sarif-ingest.service'

export type { SarifIngestJob } from './security-sarif-ingest.service'

export async function dispatchSecuritySarifIngest(
  job: SarifIngestJob
): Promise<void> {
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) {
    logger.warn(
      '[security-sarif-ingest] NEXT_PUBLIC_APP_URL unset — skipping dispatch'
    )
    return
  }
  try {
    const res = await fetch(`${base}/api/internal/security-sarif-ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify(job),
    })
    if (!res.ok) {
      logger.warn(
        `[security-sarif-ingest] worker responded ${res.status} tool=${job.tool}`
      )
    }
  } catch (error) {
    logger.warn(
      `[security-sarif-ingest] dispatch failed tool=${job.tool}:`,
      error instanceof Error ? error.message : error
    )
  }
}
