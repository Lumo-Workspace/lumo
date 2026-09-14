import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { runSummaryService } from '@/lib/services/run-summary.service'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
// LUM-576: per-session run-summary generation runs in the FOREGROUND here, so
// give it the platform max — the same budget the fold worker gets. This is the
// whole point of re-homing generation off the task route's ~15s post-completion
// waitUntil, where multiple sequential LLM calls silently ran out of time (the
// same shape as the LUM-555 fold incident).
export const maxDuration = 300

/**
 * POST /api/internal/run-summary — dedicated per-task run-summary worker
 * (LUM-576). Task completion dispatches exactly one task here instead of
 * generating inline in the cramped task-route waitUntil; one task per request
 * means no DB scan and no fan-out, so this never times out as the workspace
 * grows. Self-call only: gated by the shared CRON_SECRET (same convention as
 * /api/internal/fold and the cron routes).
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized

  let body: { taskId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const taskId = typeof body.taskId === 'string' ? body.taskId : null
  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  }

  const result = await runSummaryService.generateForTask(taskId)
  // LUM-576: surface a degraded pass (an LLM step that should have produced a
  // summary errored) instead of letting it vanish — the silent-failure mode
  // this worker exists to fix. A legitimately-empty task (no turn material) is
  // not degraded and logs nothing.
  if (result.degraded) {
    logger.error(
      `[run-summary] degraded generation for task ${taskId}: ` +
        `${result.failed} session(s) failed, ${result.generated} generated`
    )
  }
  return NextResponse.json(result)
}
