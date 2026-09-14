import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { foldService } from '@/lib/services/memory/fold.service'

export const runtime = 'nodejs'
// LUM-555: the fold pass runs the full LLM pipeline in the FOREGROUND here, so
// give it the platform max — the same budget the dry-run preview route gets.
// This is the whole point of re-homing fold off the task route's ~15s
// post-completion waitUntil: a dedicated function with a real time budget and
// the same healthy foreground gateway context the dry-run runs in.
export const maxDuration = 300

/**
 * POST /api/internal/fold — dedicated per-project fold worker (LUM-555). Task
 * completion dispatches exactly one project here instead of folding inline in
 * the cramped task-route waitUntil; one project per request means no DB scan
 * and no fan-out, so this never times out as the workspace grows. Self-call
 * only: gated by the shared CRON_SECRET (same convention as the cron routes).
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireCronAuth(request)
  if (unauthorized) return unauthorized

  let body: { projectId?: unknown; sourceSessionId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId : null
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  }
  const sourceSessionId =
    typeof body.sourceSessionId === 'string' ? body.sourceSessionId : null

  const result = await foldService.triggerForProject(projectId, sourceSessionId)
  return NextResponse.json(result)
}
