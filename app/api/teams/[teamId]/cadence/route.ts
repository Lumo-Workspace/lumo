import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { sprintService } from '@/lib/services'
import { cadenceSchema } from '@/lib/validation/sprint.schema'
import { zodError } from '@/lib/api/helpers'
import { requireTeamAccessById } from '@/lib/auth/require-team-access'

type Params = { params: Promise<{ teamId: string }> }

/**
 * PATCH /api/teams/[teamId]/cadence — Configure sprint cadence settings for a team.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { teamId } = await params

    const { memberId } = await requireTeamAccessById(teamId, userId)

    const body = await req.json()
    const parsed = cadenceSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { enabled, durationDays, cooldownDays, startWeekday, autoCreate } =
      parsed.data
    const updated = await sprintService.configureCadence(
      teamId,
      {
        enabled,
        ...(durationDays !== undefined ? { durationDays } : {}),
        ...(cooldownDays !== undefined ? { cooldownDays } : {}),
        ...(startWeekday !== undefined ? { startWeekday } : {}),
        ...(autoCreate !== undefined ? { autoCreate } : {}),
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
