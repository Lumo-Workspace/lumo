import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { errorResponse } from '@/lib/api/route-error'
import { feedbackService } from '@/lib/services/feedback.service'
import { parseFeedbackRef } from '@/lib/validation/feedback'

type Params = { params: Promise<{ ref: string }> }

/**
 * GET /api/feedback/FB-12 — LUM-1240: one report of the caller's workspace
 * with the Lumo team's replies. Another workspace's report is a 404, the same
 * as a missing one.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { ref } = await params
  const number = parseFeedbackRef(ref)
  if (number === null)
    return NextResponse.json({ error: 'Feedback not found' }, { status: 404 })
  try {
    return NextResponse.json(
      await feedbackService.show(
        { workspaceId: identity.workspaceId, memberId: identity.memberId },
        number
      )
    )
  } catch (error) {
    return errorResponse(error)
  }
}
