import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { errorResponse } from '@/lib/api/route-error'
import { feedbackService } from '@/lib/services/feedback.service'
import { parseFeedbackRef } from '@/lib/validation/feedback'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ ref: string }> }

/**
 * POST /api/feedback/FB-12/evidence — LUM-1240: attach ONE evidence file
 * (multipart `file` part) to a report the caller just sent. One file per
 * request keeps each upload under the platform's ~4.5 MB request-body limit
 * (measured on a preview deployment). Rules (submitter only, 15-minute
 * window, 5 files, types, 4 MB) live in feedbackService.attachEvidence.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { ref } = await params
  const number = parseFeedbackRef(ref)
  if (number === null)
    return NextResponse.json({ error: 'Feedback not found' }, { status: 404 })

  const form = await request.formData().catch(() => null)
  const files = form
    ? form.getAll('file').filter((f): f is File => f instanceof File)
    : []
  if (files.length !== 1)
    return NextResponse.json(
      { error: 'Expected multipart/form-data with exactly one file part' },
      { status: 400 }
    )

  try {
    return NextResponse.json(
      await feedbackService.attachEvidence(
        {
          workspaceId: identity.workspaceId,
          memberId: identity.memberId,
          origin: new URL(request.url).origin,
        },
        number,
        files[0]!
      )
    )
  } catch (error) {
    return errorResponse(error)
  }
}
