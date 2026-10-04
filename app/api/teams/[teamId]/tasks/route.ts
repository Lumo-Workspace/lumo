import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { requireTeamAccessById } from '@/lib/auth/require-team-access'

type Params = { params: Promise<{ teamId: string }> }

/**
 * GET /api/teams/[teamId]/tasks — List tasks for a team across all projects.
 *
 * Query params:
 *   ?sprintId=<id>    → tasks in that sprint
 *   ?sprintId=null    → backlog tasks (sprintId IS NULL)
 *   (omitted)         → all tasks (no sprint filter)
 *
 * Used by the Backlog panel (sprintId=null) and Sprint Board fallback.
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { teamId } = await params

    await requireTeamAccessById(teamId, identity)

    // Parse optional sprintId filter:
    //   ?sprintId=<id>   → tasks in that sprint
    //   ?sprintId=null   → backlog tasks (sprintId IS NULL)
    //   (omitted)        → all tasks (no sprint filter)
    const { searchParams } = new URL(request.url)
    const sprintIdParam = searchParams.get('sprintId')
    const sprintId: string | null | undefined =
      sprintIdParam === null
        ? undefined
        : sprintIdParam === 'null'
          ? null
          : sprintIdParam

    const tasks = await taskRepository.findByTeamWithDetails(teamId, sprintId)

    // Flatten to the shape ApiTask / Sprint Board expects.
    const shaped = tasks.map((t: any) => ({
      ...t,
      teamIdentifier: t.team?.identifier ?? '',
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
