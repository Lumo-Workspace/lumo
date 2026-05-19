import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskSlackContextService } from '@/lib/services/task-slack-context.service'

type Params = { params: Promise<{ id: string; contextId: string }> }

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id, contextId } = await params

    const task = await taskRepository.findWithProjectWorkspaceId(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const context = await taskSlackContextService.refreshContext(contextId)
    return NextResponse.json({ context })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error(
      'POST /api/tasks/[id]/slack-contexts/[contextId]/refresh error:',
      error
    )
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
