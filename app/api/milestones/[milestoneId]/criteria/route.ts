import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { milestoneExitCriteriaService } from '@/lib/services/milestone-exit-criteria.service'
import { milestoneExitCriteriaSetBodySchema } from '@/lib/validation/milestone-exit-criteria'

export const runtime = 'nodejs'

interface Params {
  params: Promise<{ milestoneId: string }>
}

/** GET /api/milestones/[milestoneId]/criteria — the milestone's exit contract. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    const result = await milestoneExitCriteriaService.listForMilestone(
      milestoneId,
      identity.memberId
    )
    return NextResponse.json(result)
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
 * PUT /api/milestones/[milestoneId]/criteria — submit the whole exit contract
 * (LUM-643, full-group replace; adjudicated rows tombstoned). Drafting is a
 * governance action — a steward session (LUM-640) does this legitimately; its
 * provenance rides the X-Lumo-Session-Id header. Locked once COMPLETED.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    const body = await request.json().catch(() => null)
    const parsed = milestoneExitCriteriaSetBodySchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const result = await milestoneExitCriteriaService.setCriteria(
      milestoneId,
      parsed.data,
      {
        actorMemberId: identity.memberId,
        sourceSessionId: request.headers.get('X-Lumo-Session-Id'),
      }
    )
    return NextResponse.json(result)
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
