import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskService, forecastService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/forecast — delivery forecast retrieved from similar
 * completed tasks' execution history.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const taskDetail = await taskService.getTaskDetail(id)
    if (!taskDetail) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      taskDetail.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const forecast = await forecastService.getTaskForecast(id)
    return NextResponse.json({ forecast })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
