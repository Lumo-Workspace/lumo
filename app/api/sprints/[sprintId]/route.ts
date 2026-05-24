import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { sprintService } from '@/lib/services'
import { sprintRepository } from '@/lib/repositories'
import { updateSprintSchema } from '@/lib/validation/sprint.schema'
import { zodError } from '@/lib/api/helpers'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'

type Params = { params: Promise<{ sprintId: string }> }

/**
 * GET /api/sprints/[sprintId] — Fetch a single sprint with task progress.
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
      sprint.team.workspaceId,
      sprint.teamId,
      identity.clerkId
    )

    const [done, total] = await Promise.all([
      sprintRepository.countTasks(sprintId, { status: 'DONE' }),
      sprintRepository.countTasks(sprintId),
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

/**
 * PATCH /api/sprints/[sprintId] — Update sprint metadata. Editable in any
 * state; the service rejects date ranges that overlap another sprint on the
 * same team.
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity
    const { sprintId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    const { memberId } = await requireTeamMemberOrOwner(
      sprint.team.workspaceId,
      sprint.teamId,
      identity.clerkId
    )

    const body = await req.json()
    const parsed = updateSprintSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const updated = await sprintService.updateMeta(
      sprintId,
      {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.startDate !== undefined
          ? { startDate: parsed.data.startDate }
          : {}),
        ...(parsed.data.endDate !== undefined
          ? { endDate: parsed.data.endDate }
          : {}),
      },
      { memberId }
    )

    return NextResponse.json(updated)
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
 * DELETE /api/sprints/[sprintId] — Remove a DRAFT sprint.
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity
    const { sprintId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    const { memberId } = await requireTeamMemberOrOwner(
      sprint.team.workspaceId,
      sprint.teamId,
      identity.clerkId
    )

    await sprintService.remove(sprintId, { memberId })

    return new NextResponse(null, { status: 204 })
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
