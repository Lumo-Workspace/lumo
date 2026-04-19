import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { sprintService } from '@/lib/services'
import { sprintRepository } from '@/lib/repositories'
import { updateSprintSchema } from '@/lib/validation/sprint.schema'
import { zodError } from '@/lib/api/helpers'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'

type Params = { params: Promise<{ sprintId: string }> }

/**
 * GET /api/sprints/[sprintId] — Fetch a single sprint with task progress.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { sprintId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    await requireTeamMemberOrOwner(
      sprint.team.workspaceId,
      sprint.teamId,
      userId
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
 * PATCH /api/sprints/[sprintId] — Update a DRAFT sprint's metadata.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { sprintId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    await requireTeamMemberOrOwner(
      sprint.team.workspaceId,
      sprint.teamId,
      userId
    )

    if (sprint.status !== 'DRAFT') {
      return NextResponse.json(
        { error: `cannot edit sprint in ${sprint.status} state` },
        { status: 409 }
      )
    }

    const body = await req.json()
    const parsed = updateSprintSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { name, startDate, endDate } = parsed.data
    const updated = await sprintRepository.update(sprintId, {
      ...(name !== undefined ? { name } : {}),
      ...(startDate !== undefined ? { startDate } : {}),
      ...(endDate !== undefined ? { endDate } : {}),
    })

    return NextResponse.json({ sprint: updated })
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
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { sprintId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    const { memberId } = await requireTeamMemberOrOwner(
      sprint.team.workspaceId,
      sprint.teamId,
      userId
    )

    await sprintService.removeDraft(sprintId, { memberId })

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
