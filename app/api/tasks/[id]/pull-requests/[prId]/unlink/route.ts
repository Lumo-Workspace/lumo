import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskService } from '@/lib/services'
import { taskRepository } from '@/lib/repositories/task.repository'

type Params = { params: Promise<{ id: string; prId: string }> }

/**
 * POST /api/tasks/[id]/pull-requests/[prId]/unlink — Unlink a PR from a task.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id, prId } = await params

    const task = await taskRepository.findWithProject(id)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    await taskService.unlinkPullRequest(id, prId)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
