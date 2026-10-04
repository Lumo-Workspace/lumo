import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { sprintRepository } from '@/lib/repositories'
import { sprintBurnupService } from '@/lib/services/sprint-burnup.service'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'

type Params = { params: Promise<{ sprintId: string }> }

/**
 * GET /api/sprints/[sprintId]/burnup — Reconstructed scope/completed/projected
 * series for a sprint.
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

    const data = await sprintBurnupService.compute(sprintId, new Date())
    return NextResponse.json(data)
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
