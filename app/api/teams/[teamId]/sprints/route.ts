import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { sprintService } from '@/lib/services'
import { sprintRepository } from '@/lib/repositories'
import { createSprintSchema } from '@/lib/validation/sprint.schema'
import { zodError } from '@/lib/api/helpers'
import { z } from 'zod'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'

type Params = { params: Promise<{ teamId: string }> }

/**
 * POST /api/teams/[teamId]/sprints — Create a new draft sprint for the team.
 */
export async function POST(req: NextRequest, { params }: Params) {
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

    const { memberId } = await requireTeamMemberOrOwner(
      team.workspaceId,
      team.id,
      userId
    )

    const body = await req.json()
    const parsed = createSprintSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { name, startDate, endDate } = parsed.data
    const sprint = await sprintService.createDraft(
      team.id,
      {
        ...(name !== undefined ? { name } : {}),
        ...(startDate !== undefined ? { startDate } : {}),
        ...(endDate !== undefined ? { endDate } : {}),
      },
      { memberId }
    )
    return NextResponse.json(sprint, { status: 201 })
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
 * GET /api/teams/[teamId]/sprints — List sprints for the team.
 * Query params: status, cursor, limit (default 20)
 */
export async function GET(req: NextRequest, { params }: Params) {
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

    const url = new URL(req.url)
    const statusRaw = url.searchParams.get('status')
    const statusParsed = z
      .enum(['DRAFT', 'ACTIVE', 'CLOSED'])
      .optional()
      .safeParse(statusRaw ?? undefined)
    if (!statusParsed.success) return zodError(statusParsed)
    const statusParam = statusParsed.data
    const cursorParam = url.searchParams.get('cursor')
    const limit = Number(url.searchParams.get('limit') ?? 20)

    const sprints = await sprintRepository.listByTeam(team.id, {
      ...(statusParam !== undefined ? { status: statusParam } : {}),
      ...(cursorParam !== null ? { cursor: cursorParam } : {}),
      limit,
    })
    return NextResponse.json({ sprints })
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
