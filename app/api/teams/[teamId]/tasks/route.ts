import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'
import { prisma } from '@/lib/db/prisma'

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
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { teamId } = await params

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, workspaceId: true },
    })
    if (!team)
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })

    await requireTeamMemberOrOwner(team.workspaceId, team.id, userId)

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
