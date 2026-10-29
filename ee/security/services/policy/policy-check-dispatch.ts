/**
 * Dispatch helper for the code-rule policy-check worker (LUM-590).
 *
 * Mirrors lib/services/run-summary-dispatch.ts exactly:
 * - NO gateway / LLM imports (keeps this file safe to statically import into
 *   the security plugin's entry without dragging the @ai-sdk/gateway
 *   TransformStream into every jest test that loads the plugin registry).
 * - Best-effort: failures are logged and swallowed — must never throw, or they
 *   could roll back a task-status transition.
 *
 * LUM-1063: the worker's context resolver (`resolvePolicyCheckContext`)
 * moved to `./policy-check-context` so this file needs only the logger — the
 * security plugin's entry imports it statically for the synchronous
 * `task.statusChanged` handler.
 */

import { logger } from '@/lib/logger'
import { resolveAppUrl } from '@/lib/config/public-config'

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget dispatch to the policy-check foreground worker
 * (POST /api/internal/policy-check). The worker has its own 300s budget;
 * this call hands off and returns immediately.
 *
 * A missing NEXT_PUBLIC_APP_URL (e.g. local dev) is silently skipped.
 * Any fetch error is caught and logged — never re-thrown.
 */
export async function dispatchPolicyCheck(taskId: string): Promise<void> {
  const base = resolveAppUrl()
  if (!base) {
    logger.warn(
      '[policy-check] NEXT_PUBLIC_APP_URL unset — skipping policy-check dispatch'
    )
    return
  }
  try {
    await fetch(`${base}/api/internal/policy-check`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({ taskId }),
    })
  } catch (error) {
    logger.warn(
      `[policy-check] policy-check dispatch failed task=${taskId}:`,
      error instanceof Error ? error.message : error
    )
  }
}
