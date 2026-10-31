import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { zodError } from '@/lib/api/helpers'
import { errorResponse } from '@/lib/api/route-error'
import { adminWaitlistQuerySchema } from '@/lib/validation/platform-admin'
import { waitlistAdmin } from '@/lib/services/waitlist-admin.service'
import { platformAdminAudit } from '@/lib/services/platform-admin-audit.service'

/** GET /api/admin/waitlist — platform admin: list waitlist entries. */
export async function GET(request: Request) {
  const admin = await requirePlatformAdmin(request)
  if (admin instanceof NextResponse) return admin
  try {
    const parsed = adminWaitlistQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    )
    if (!parsed.success) return zodError(parsed)
    const result = await waitlistAdmin.list(parsed.data)
    await platformAdminAudit.record({
      adminUserId: admin.userId,
      action: 'waitlist.list',
      targetType: 'waitlist',
      targetId: '*',
      metadata: { query: parsed.data },
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
