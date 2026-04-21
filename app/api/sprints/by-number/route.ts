import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { sprintRepository } from '@/lib/repositories'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'

/**
 * GET /api/sprints/by-number?workspaceUrl=X&number=N
 *
 * Resolves a sprint by its per-team `number` scoped to the workspace so
 * front-end URLs can use the friendly number instead of the CUID. Assumes
 * the workspace has at most one sprints-enabled team (the agreed constraint
 * for this URL scheme).
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const workspaceUrl = req.nextUrl.searchParams.get('workspaceUrl')
    const numberStr = req.nextUrl.searchParams.get('number')
    const number = numberStr ? Number(numberStr) : NaN
    if (!Number.isInteger(number) || number <= 0) {
      return NextResponse.json(
        { error: 'number must be a positive integer' },
        { status: 400 }
      )
    }

    const ws = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (ws instanceof NextResponse) return ws

    const sprint = await sprintRepository.findByWorkspaceAndNumber(
      ws.workspaceId,
      number
    )
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    await requireTeamMemberOrOwner(
      sprint.team.workspaceId,
      sprint.teamId,
      userId
    )

    const [done, total] = await Promise.all([
      sprintRepository.countTasks(sprint.id, { status: 'DONE' }),
      sprintRepository.countTasks(sprint.id),
    ])

    return NextResponse.json({ sprint, progress: { done, total } })
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
