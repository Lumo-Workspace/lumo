import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { zodError } from '@/lib/api/helpers'
import { errorResponse } from '@/lib/api/route-error'
import { adminUsageQuerySchema } from '@/lib/validation/platform-admin'
import { platformAdminService } from '@/lib/services/platform-admin.service'
import { platformAdminAudit } from '@/lib/services/platform-admin-audit.service'

/** GET /api/admin/usage?month=YYYY-MM — platform admin: LLM spend per workspace. */
export async function GET(request: Request) {
  const admin = await requirePlatformAdmin(request)
  if (admin instanceof NextResponse) return admin
  try {
    const parsed = adminUsageQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    )
    if (!parsed.success) return zodError(parsed)
    const result = await platformAdminService.usage(parsed.data.month)
    await platformAdminAudit.record({
      adminUserId: admin.userId,
      action: 'usage.view',
      targetType: 'usage',
      targetId: result.month,
      metadata: { month: result.month },
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
