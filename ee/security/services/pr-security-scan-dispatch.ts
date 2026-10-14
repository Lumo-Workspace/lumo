/**
 * Dispatch helper for the PR security-scan worker (LUM-732).
 *
 * Mirrors lib/services/policy/policy-check-dispatch.ts exactly:
 * - NO gateway / LLM imports (safe to import statically from webhook handlers
 *   and task-pr-link.service).
 * - Best-effort: failures are logged and swallowed — never throws, so a PR
 *   webhook or a link call can never fail because the scanner is down.
 */
import { logger } from '@/lib/logger'

/**
 * LUM-735: `SARIF_PUSH` is the ingest worker asking stage A to run on a scan
 * row the SARIF push created before any PR webhook arrived.
 */
export type ScanDispatchTrigger = 'PR_EVENT' | 'PR_LINK' | 'SARIF_PUSH'

// LUM-1133: `ready_for_review` — a draft marked ready is reviewed at its
// current head (drafts are skipped by default for PRs without a task).
const SCAN_ACTIONS = new Set([
  'opened',
  'reopened',
  'synchronize',
  'ready_for_review',
])

/** PURE — which pull_request webhook events warrant a scan. */
export function shouldScanOnPrEvent(action: string, state: string): boolean {
  return state === 'open' && SCAN_ACTIONS.has(action)
}

export async function dispatchPrSecurityScan(
  pullRequestId: string,
  trigger: ScanDispatchTrigger,
  reviewMode?: 'incremental' | 'full'
): Promise<void> {
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) {
    logger.warn(
      '[pr-security-scan] NEXT_PUBLIC_APP_URL unset — skipping dispatch'
    )
    return
  }
  try {
    const res = await fetch(`${base}/api/internal/pr-security-scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({ pullRequestId, trigger, reviewMode }),
    })
    if (!res.ok) {
      logger.warn(
        `[pr-security-scan] worker responded ${res.status} pr=${pullRequestId}`
      )
    }
  } catch (error) {
    logger.warn(
      `[pr-security-scan] dispatch failed pr=${pullRequestId}:`,
      error instanceof Error ? error.message : error
    )
  }
}
