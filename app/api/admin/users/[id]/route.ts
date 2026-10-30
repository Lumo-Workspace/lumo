import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { errorResponse } from '@/lib/api/route-error'
import { platformAdminService } from '@/lib/services/platform-admin.service'
import { platformAdminAudit } from '@/lib/services/platform-admin-audit.service'

/** GET /api/admin/users/[id] — platform admin: one user (404 records nothing). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requirePlatformAdmin(request)
  if (admin instanceof NextResponse) return admin
  try {
    const { id } = await params
    const result = await platformAdminService.getUser(id)
    await platformAdminAudit.record({
      adminUserId: admin.userId,
      action: 'user.view',
      targetType: 'user',
      targetId: id,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
