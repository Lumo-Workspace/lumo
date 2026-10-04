import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { sprintRepository, taskRepository } from '@/lib/repositories'
import { shapeSprintTask } from '@/lib/api/task-shape'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'
import { getSprintBlockers } from '@/lib/services/stats.service'

/**
 * GET /api/sprints/by-number?workspaceUrl=X&number=N
 *
 * Resolves a sprint by its per-team `number` scoped to the workspace so
 * front-end URLs can use the friendly number instead of the CUID. Assumes
 * the workspace has at most one sprints-enabled team (the agreed constraint
 * for this URL scheme).
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function GET(req: NextRequest) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity

    const workspaceUrl = req.nextUrl.searchParams.get('workspaceUrl')
    const numberStr = req.nextUrl.searchParams.get('number')
    const number = numberStr ? Number(numberStr) : NaN
    if (!Number.isInteger(number) || number <= 0) {
      return NextResponse.json(
        { error: 'number must be a positive integer' },
        { status: 400 }
      )
    }

    // Validate that the requested workspaceUrl matches the caller's workspace.
    if (!workspaceUrl) {
      return NextResponse.json(
        { error: 'workspaceUrl is required' },
        { status: 400 }
      )
    }
    if (identity.workspaceSlug !== workspaceUrl) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const sprint = await sprintRepository.findByWorkspaceAndNumber(
      identity.workspaceId,
      number
    )
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    await requireTeamMemberOrOwner(
      identity,
      { workspaceId: sprint.team.workspaceId, teamId: sprint.teamId },
      'Sprint not found'
    )

    // Fetch tasks alongside progress/blockers so the detail page gets sprint +
    // tasks in one round trip. Previously the client resolved the sprint
    // here, then fired a second request to /sprints/[id]/tasks gated on the
    // returned id — a serial waterfall worth ~300-500ms of skeleton. The
    // client seeds the tasks.bySprint cache from `tasks` below (LUM-200).
    const [done, total, topBlockers, sprintTasks, priorCompletionRates] =
      await Promise.all([
        sprintRepository.countTasks(sprint.id, { status: 'DONE' }),
        sprintRepository.countTasks(sprint.id),
        getSprintBlockers(sprint.id, sprint.team.workspaceId),
        taskRepository.findBySprint(sprint.id),
        sprintRepository.completedCompletionRates(sprint.teamId, sprint.id),
      ])

    return NextResponse.json({
      sprint,
      progress: { done, total, priorCompletionRates },
      topBlockers,
      tasks: sprintTasks.map(shapeSprintTask),
    })
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
