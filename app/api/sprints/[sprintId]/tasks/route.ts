import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { sprintService } from '@/lib/services'
import { sprintRepository, taskRepository } from '@/lib/repositories'
import { addTaskToSprintSchema } from '@/lib/validation/sprint.schema'
import { zodError } from '@/lib/api/helpers'
import { shapeSprintTask } from '@/lib/api/task-shape'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'
import { getHumanActorId } from '@/lib/actor'

type Params = { params: Promise<{ sprintId: string }> }

/**
 * GET /api/sprints/[sprintId]/tasks — List all tasks in a sprint (across all projects).
 * Used by the Sprint Board (Kanban view) which is team-scoped.
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity
    const { sprintId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    await requireTeamMemberOrOwner(
      identity,
      { workspaceId: sprint.team.workspaceId, teamId: sprint.teamId },
      'Sprint not found'
    )

    const tasks = await taskRepository.findBySprint(sprintId)

    // Flatten to the MyTask shape (mirrors /api/tasks/me) so the frontend
    // can render the shared TaskWorkspace (list + board) on the sprint page.
    // Shared with /api/sprints/by-number so the detail page can seed this
    // cache from the sprint response (no serial waterfall).
    const shaped = tasks.map(shapeSprintTask)

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
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity
    const { sprintId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    const { memberId } = await requireTeamMemberOrOwner(
      identity,
      { workspaceId: sprint.team.workspaceId, teamId: sprint.teamId },
      'Sprint not found'
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
