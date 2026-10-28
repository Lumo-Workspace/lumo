import { logger } from '@/lib/logger'
import { resolveAppUrl } from '@/lib/config/public-config'

/**
 * Hand one project's fold pass to the dedicated foreground worker
 * (POST /api/internal/fold) from the post-task-completion waitUntil — so the
 * heavy LLM fold no longer runs inline in the task route's cramped ~15s
 * function. The worker has its own 300s budget and the same healthy foreground
 * gateway context the dry-run preview runs in (LUM-555). One project per
 * dispatch → no DB scan, no fan-out, never times out as the workspace grows.
 *
 * This module deliberately has NO gateway/LLM imports (unlike fold.service), so
 * the dispatcher can be pulled into task-state.service without dragging the AI
 * SDK graph into that module's static import chain.
 *
 * Best-effort: a dispatch failure (or a missing app URL) is logged and
 * swallowed — it must never throw, or it could roll back task completion.
 */
export async function dispatchProjectFold(
  projectId: string,
  sourceSessionId: string | null
): Promise<void> {
  const base = resolveAppUrl()
  if (!base) {
    logger.warn(
      '[memory.fold] NEXT_PUBLIC_APP_URL unset — skipping fold dispatch'
    )
    return
  }
  try {
    await fetch(`${base}/api/internal/fold`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({ projectId, sourceSessionId }),
    })
  } catch (error) {
    logger.warn(
      `[memory.fold] fold dispatch failed project=${projectId}:`,
      error instanceof Error ? error.message : error
    )
  }
}
