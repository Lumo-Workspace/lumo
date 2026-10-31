import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { errorResponse } from '@/lib/api/route-error'
import { platformAdminService } from '@/lib/services/platform-admin.service'
import { platformAdminAudit } from '@/lib/services/platform-admin-audit.service'

/** GET /api/admin/overview — platform admin: headline counts. */
export async function GET(request: Request) {
  const admin = await requirePlatformAdmin(request)
  if (admin instanceof NextResponse) return admin
  try {
    const result = await platformAdminService.overview()
    await platformAdminAudit.record({
      adminUserId: admin.userId,
      action: 'usage.view',
      targetType: 'usage',
      targetId: 'overview',
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
