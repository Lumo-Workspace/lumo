import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { sprintService } from '@/lib/services'
import { sprintRepository } from '@/lib/repositories'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'
import { getHumanActorId } from '@/lib/actor'

type Params = { params: Promise<{ sprintId: string; taskId: string }> }

/**
 * DELETE /api/sprints/[sprintId]/tasks/[taskId] — Remove a task from a sprint.
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity
    const { sprintId, taskId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    const { memberId } = await requireTeamMemberOrOwner(
      identity,
      { workspaceId: sprint.team.workspaceId, teamId: sprint.teamId },
      'Sprint not found'
    )

    const actorId = await getHumanActorId(memberId)
    await sprintService.removeTaskFromSprint(taskId, {
      memberId,
      ...(actorId ? { id: actorId } : {}),
    })

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
