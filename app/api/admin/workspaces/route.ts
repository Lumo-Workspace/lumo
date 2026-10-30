import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { zodError } from '@/lib/api/helpers'
import { errorResponse } from '@/lib/api/route-error'
import { adminListQuerySchema } from '@/lib/validation/platform-admin'
import { platformAdminService } from '@/lib/services/platform-admin.service'
import { platformAdminAudit } from '@/lib/services/platform-admin-audit.service'

/** GET /api/admin/workspaces — platform admin: list (workspaces). */
export async function GET(request: Request) {
  const admin = await requirePlatformAdmin(request)
  if (admin instanceof NextResponse) return admin
  try {
    const parsed = adminListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    )
    if (!parsed.success) return zodError(parsed)
    const result = await platformAdminService.listWorkspaces(parsed.data)
    await platformAdminAudit.record({
      adminUserId: admin.userId,
      action: 'workspace.list',
      targetType: 'workspace',
      targetId: '*',
      metadata: { query: parsed.data },
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
