import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { sprintService } from '@/lib/services'
import { sprintRepository } from '@/lib/repositories'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'

type Params = { params: Promise<{ sprintId: string; taskId: string }> }

/**
 * DELETE /api/sprints/[sprintId]/tasks/[taskId] — Remove a task from a sprint.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { sprintId, taskId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    const { memberId } = await requireTeamMemberOrOwner(
      sprint.team.workspaceId,
      sprint.teamId,
      userId
    )

    await sprintService.removeTaskFromSprint(taskId, { memberId, id: userId })

    return new NextResponse(null, { status: 204 })
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
