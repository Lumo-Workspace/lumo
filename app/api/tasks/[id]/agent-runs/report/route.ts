import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { agentRunReportService } from '@/lib/services/agent-run-report.service'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/agent-runs/report — the headless "Agent runs" read
 * model behind `lumo task runs` (LUM-1188): the web's timeline + progress,
 * derived the same way, with agent-produced text guarded and no transcripts.
 * Browser session or API key; another workspace's task → 404.
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

    return NextResponse.json(await agentRunReportService.getReport(task.id))
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
