import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { timelineService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/timeline — activity + comments, oldest first, paged.
 * Browser session or CLI bearer (LUM-821: `lumo task history`). A task in
 * another workspace reads as 404.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const task = await taskRepository.findWithProjectWorkspaceId(id)
    if (!task || task.project.workspaceId !== identity.workspaceId) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const url = new URL(request.url)
    const cursorParam = url.searchParams.get('cursor')
    const limitParam = url.searchParams.get('limit')
    const limit = Math.min(
      Math.max(parseInt(limitParam ?? '30', 10) || 30, 1),
      100
    )

    let cursor:
      | { timestamp: string; id: string; source: 'activity' | 'comment' }
      | undefined
    if (cursorParam) {
      try {
        cursor = JSON.parse(cursorParam)
      } catch {
        return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
      }
    }

    const result = await timelineService.getTimeline(id, { limit, cursor })

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
