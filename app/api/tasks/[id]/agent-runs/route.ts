import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { agentRunTimelineService } from '@/lib/services/agent-run-timeline.service'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/agent-runs — the task's Agent Run timeline.
 * LUM-1188: browser session or API key; the task must belong to the caller's
 * workspace (another workspace's task → 404).
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id } = await params
    const task = await resolveTaskParam(id, identity.workspaceId)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const result = await agentRunTimelineService.getTimeline(task.id)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
