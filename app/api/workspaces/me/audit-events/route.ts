import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { auditEventQuerySchema } from '@/lib/validation/audit'
import { auditQueryService } from '@/lib/services/audit-query.service'

/**
 * GET /api/workspaces/me/audit-events — the caller's workspace audit log,
 * newest first, one keyset page (LUM-907). OWNER only (403 otherwise).
 * Browser session or CLI bearer (`lumo audit list`). Query: action, actor,
 * since, until, targetType, targetId, cursor, limit.
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const parsed = auditEventQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    )
    if (!parsed.success) return zodError(parsed)
    const page = await auditQueryService.list(
      {
        workspaceId: identity.workspaceId,
        memberId: identity.memberId,
        clerkId: identity.clerkId,
      },
      parsed.data
    )
    return NextResponse.json(page, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return serviceErrorResponse(error, '[GET /api/workspaces/me/audit-events]')
  }
}
