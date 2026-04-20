import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { sprintService } from '@/lib/services'
import { sprintRepository, taskRepository } from '@/lib/repositories'
import { addTaskToSprintSchema } from '@/lib/validation/sprint.schema'
import { zodError } from '@/lib/api/helpers'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'
import { getHumanActorId } from '@/lib/actor'

type Params = { params: Promise<{ sprintId: string }> }

/**
 * GET /api/sprints/[sprintId]/tasks — List all tasks in a sprint (across all projects).
 * Used by the Sprint Board (Kanban view) which is team-scoped.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { sprintId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    await requireTeamMemberOrOwner(
      sprint.team.workspaceId,
      sprint.teamId,
      userId
    )

    const tasks = await taskRepository.findBySprint(sprintId)

    // Flatten to the shape ApiTask / ProjectTaskCard expects.
    // Mirrors the transform in /api/projects/[id]/tasks/route.ts.
    const shaped = tasks.map((t: any) => ({
      ...t,
      teamIdentifier: t.team?.identifier ?? '',
      parent: t.parent
        ? {
            id: t.parent.id,
            title: t.parent.title,
            number: t.parent.number,
            teamIdentifier: t.parent.team?.identifier ?? '',
          }
        : null,
      _count: t._count,
      childrenDoneCount: Array.isArray(t.children) ? t.children.length : 0,
    }))

    return NextResponse.json({ tasks: shaped })
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

/**
 * POST /api/sprints/[sprintId]/tasks — Add a task to a sprint.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { sprintId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    const { memberId } = await requireTeamMemberOrOwner(
      sprint.team.workspaceId,
      sprint.teamId,
      userId
    )

    const body = await req.json()
    const parsed = addTaskToSprintSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const actorId = await getHumanActorId(memberId)
    const result = await sprintService.addTaskToSprint(
      parsed.data.taskId,
      sprintId,
      { memberId, ...(actorId ? { id: actorId } : {}) }
    )

    return NextResponse.json(result, { status: 201 })
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
