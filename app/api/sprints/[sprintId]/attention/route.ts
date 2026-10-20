import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { sprintRepository } from '@/lib/repositories'
import { sprintAttentionService } from '@/lib/services/sprint-attention.service'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'
import { sprintAttentionQuerySchema } from '@/lib/validation/sprint.schema'

type Params = { params: Promise<{ sprintId: string }> }

/**
 * GET /api/sprints/[sprintId]/attention?scope=team|mine — the attention-first
 * Sprint page's single read (LUM-1278): the awaiting-people queue, per-task
 * trust + verified, stage counts with median dwell, and cost vs. the previous
 * sprint. Durations are computed here against one server-side `now`.
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity
    const { sprintId } = await params

    const query = sprintAttentionQuerySchema.safeParse({
      scope: req.nextUrl.searchParams.get('scope') ?? undefined,
    })
    if (!query.success)
      return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    await requireTeamMemberOrOwner(
      identity,
      { workspaceId: sprint.team.workspaceId, teamId: sprint.teamId },
      'Sprint not found'
    )

    const data = await sprintAttentionService.getForSprint(
      {
        id: sprint.id,
        number: sprint.number,
        teamId: sprint.teamId,
        workspaceId: sprint.team.workspaceId,
      },
      {
        viewerMemberId: identity.memberId,
        scope: query.data.scope,
        now: new Date(),
      }
    )
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
