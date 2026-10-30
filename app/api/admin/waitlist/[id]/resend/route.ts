import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { errorResponse } from '@/lib/api/route-error'
import { waitlistAdmin } from '@/lib/services/waitlist-admin.service'
import { platformAdminAudit } from '@/lib/services/platform-admin-audit.service'

/** POST /api/admin/waitlist/[id]/resend — platform admin. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requirePlatformAdmin(request)
  if (admin instanceof NextResponse) return admin
  try {
    const { id } = await params
    const result = await waitlistAdmin.resend(id, admin.userId)
    await platformAdminAudit.record({
      adminUserId: admin.userId,
      action: 'waitlist.resend',
      targetType: 'waitlist',
      targetId: id,
      metadata: { email: result.email },
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
