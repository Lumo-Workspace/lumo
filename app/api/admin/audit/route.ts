import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { zodError } from '@/lib/api/helpers'
import { errorResponse } from '@/lib/api/route-error'
import { adminAuditQuerySchema } from '@/lib/validation/platform-admin'
import { platformAdminAudit } from '@/lib/services/platform-admin-audit.service'

/** GET /api/admin/audit — platform admin: the admin audit log, newest first. */
export async function GET(request: Request) {
  const admin = await requirePlatformAdmin(request)
  if (admin instanceof NextResponse) return admin
  try {
    const parsed = adminAuditQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    )
    if (!parsed.success) return zodError(parsed)
    const { adminUserId, targetType, targetId, cursor, limit } = parsed.data
    const result = await platformAdminAudit.list({
      limit,
      ...(adminUserId ? { adminUserId } : {}),
      ...(targetType ? { targetType } : {}),
      ...(targetId ? { targetId } : {}),
      ...(cursor ? { cursor } : {}),
    })
    await platformAdminAudit.record({
      adminUserId: admin.userId,
      action: 'audit.list',
      targetType: 'audit',
      targetId: '*',
      metadata: { query: parsed.data },
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
