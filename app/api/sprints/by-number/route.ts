import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { sprintRepository } from '@/lib/repositories'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'
import { getSprintRisk } from '@/lib/services/stats.service'

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
      sprint.team.workspaceId,
      sprint.teamId,
      identity.clerkId
    )

    const [done, total, sprintRisk] = await Promise.all([
      sprintRepository.countTasks(sprint.id, { status: 'DONE' }),
      sprintRepository.countTasks(sprint.id),
      getSprintRisk(sprint.id, sprint.team.workspaceId),
    ])

    return NextResponse.json({
      sprint,
      progress: { done, total },
      risk: sprintRisk.risk,
      topBlockers: sprintRisk.topBlockers,
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
