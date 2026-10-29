import { logger } from '@/lib/logger'
import { resolveAppUrl } from '@/lib/config/public-config'

/**
 * Hand one task's per-session run-summary generation to the dedicated
 * foreground worker (POST /api/internal/run-summary) from the
 * post-task-completion waitUntil — so the per-session LLM calls no longer run
 * inline in the task route's cramped ~15s function, where they silently failed
 * (LUM-576, the same shape as the LUM-555 fold incident). The worker has its
 * own 300s budget and a healthy foreground gateway context. One task per
 * dispatch → no DB scan, no fan-out.
 *
 * This module deliberately has NO gateway/LLM imports (unlike
 * run-summary.service, which pulls in @ai-sdk/gateway), so the dispatcher can be
 * statically imported into task-state.service without dragging the AI SDK graph
 * into that module's import chain (the jest TransformStream trap).
 *
 * Best-effort: a dispatch failure (or a missing app URL) is logged and
 * swallowed — it must never throw, or it could roll back task completion. The
 * worker invocation is a separate serverless function, so even if this caller's
 * waitUntil is torn down before the fetch resolves, the worker still runs to
 * completion on its own 300s budget.
 */
export async function dispatchRunSummaries(taskId: string): Promise<void> {
  const base = resolveAppUrl()
  if (!base) {
    logger.warn(
      '[run-summary] NEXT_PUBLIC_APP_URL unset — skipping run-summary dispatch'
    )
    return
  }
  try {
    await fetch(`${base}/api/internal/run-summary`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({ taskId }),
    })
  } catch (error) {
    logger.warn(
      `[run-summary] run-summary dispatch failed task=${taskId}:`,
      error instanceof Error ? error.message : error
    )
  }
}
