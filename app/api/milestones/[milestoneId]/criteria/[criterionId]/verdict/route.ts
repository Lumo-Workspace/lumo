import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { milestoneExitCriteriaService } from '@/lib/services/milestone-exit-criteria.service'
import { milestoneExitVerdictBodySchema } from '@/lib/validation/milestone-exit-criteria'

export const runtime = 'nodejs'

interface Params {
  params: Promise<{ milestoneId: string; criterionId: string }>
}

/**
 * POST /api/milestones/[milestoneId]/criteria/[criterionId]/verdict —
 * adjudicate (裁定) one exit criterion (LUM-643). Adjudication is a
 * governance action: the milestone's steward session (LUM-640) is the
 * intended adjudicating subject on the CLI path, and its provenance rides
 * the X-Lumo-Session-Id header; humans adjudicate via the web. The
 * referent-grounding gate (MET + EXTERNAL_FACT without evidence, MET +
 * PENDING_OUTCOME) rejects with 422 in the service.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId, criterionId } = await params

    const body = await request.json().catch(() => null)
    const parsed = milestoneExitVerdictBodySchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const result = await milestoneExitCriteriaService.adjudicate(
      milestoneId,
      criterionId,
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
