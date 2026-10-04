import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { sprintService } from '@/lib/services'
import { sprintRepository } from '@/lib/repositories'
import { createSprintSchema } from '@/lib/validation/sprint.schema'
import { zodError } from '@/lib/api/helpers'
import { z } from 'zod'
import { requireTeamAccessById } from '@/lib/auth/require-team-access'

type Params = { params: Promise<{ teamId: string }> }

/**
 * POST /api/teams/[teamId]/sprints — Create a new draft sprint for the team.
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity
    const { teamId } = await params

    const { memberId } = await requireTeamAccessById(teamId, identity)

    const body = await req.json()
    const parsed = createSprintSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { name, startDate, endDate } = parsed.data
    const sprint = await sprintService.createDraft(
      teamId,
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
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity
    const { teamId } = await params

    await requireTeamAccessById(teamId, identity)

    // Lazily roll sprint state forward (auto start/close at window boundaries)
    // and top up future DRAFT sprints per cadence config. We await both so the
    // response reflects the freshly-transitioned + created sprints; failures
    // are opportunistic and non-fatal.
    try {
      await sprintService.reconcileSprintStates(teamId)
    } catch {
      // Non-fatal — continue serving the list.
    }
    try {
      await sprintService.ensureFutureSprints(teamId)
    } catch {
      // Non-fatal — continue serving the list.
    }

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

    const sprints = await sprintRepository.listByTeam(teamId, {
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
