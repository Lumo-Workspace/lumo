import { NextRequest, NextResponse } from 'next/server'
import { requireStaff } from '@/lib/auth/staff'
import { errorResponse } from '@/lib/api/route-error'
import { feedbackStaffService } from '@/lib/services/feedback-staff.service'
import {
  parseStaffFeedbackRef,
  staffUpdateFeedbackSchema,
} from '@/lib/validation/feedback'

type Params = { params: Promise<{ seq: string }> }

const notFound = () =>
  NextResponse.json({ error: 'Feedback not found' }, { status: 404 })

/**
 * GET /api/staff/feedback/<seq> — LUM-1240 batch 2: one report of any
 * workspace with every reply (authors by name). Lumo staff only (403).
 */
export async function GET(request: NextRequest, { params }: Params) {
  const staff = await requireStaff(request)
  if (staff instanceof NextResponse) return staff

  const seq = parseStaffFeedbackRef((await params).seq)
  if (seq === null) return notFound()
  try {
    return NextResponse.json(await feedbackStaffService.show(seq))
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PATCH /api/staff/feedback/<seq> — `{ status?, reply? }`: change the status
 * and / or append a reply the customer will read, in one transaction. Lumo
 * staff only (403). The reply's user confirmation is the CLI's exit-4
 * envelope (`lumo staff feedback update --reply … --confirm`).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const staff = await requireStaff(request)
  if (staff instanceof NextResponse) return staff

  const seq = parseStaffFeedbackRef((await params).seq)
  if (seq === null) return notFound()
  const parsed = staffUpdateFeedbackSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid update', issues: parsed.error.issues },
      { status: 400 }
    )
  try {
    return NextResponse.json(
      await feedbackStaffService.update(
        { memberId: staff.memberId },
        seq,
        parsed.data
      )
    )
  } catch (error) {
    return errorResponse(error)
  }
}
