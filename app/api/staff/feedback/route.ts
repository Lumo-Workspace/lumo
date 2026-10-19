import { NextRequest, NextResponse } from 'next/server'
import { requireStaff } from '@/lib/auth/staff'
import { errorResponse } from '@/lib/api/route-error'
import { feedbackStaffService } from '@/lib/services/feedback-staff.service'
import { staffListFeedbackQuerySchema } from '@/lib/validation/feedback'

/**
 * GET /api/staff/feedback — LUM-1240 batch 2: every workspace's feedback,
 * newest first (`?status=&kind=&workspace=<id>&limit=&cursor=`). Lumo staff
 * only (`requireStaff`: an OWNER of a workspace in LUMO_STAFF_WORKSPACE_IDS);
 * anyone else gets 403.
 */
export async function GET(request: NextRequest) {
  const staff = await requireStaff(request)
  if (staff instanceof NextResponse) return staff

  const parsed = staffListFeedbackQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  )
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.issues },
      { status: 400 }
    )
  try {
    return NextResponse.json(await feedbackStaffService.list(parsed.data))
  } catch (error) {
    return errorResponse(error)
  }
}
