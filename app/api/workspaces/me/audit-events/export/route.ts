import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { auditEventQuerySchema } from '@/lib/validation/audit'
import { auditQueryService } from '@/lib/services/audit-query.service'

/**
 * GET /api/workspaces/me/audit-events/export — the filtered audit log as a
 * CSV download, newest first, capped (LUM-907). OWNER only. Same filters as
 * the list route. `X-Audit-Truncated: true` = more events matched than the
 * cap; narrow the date range to get the rest.
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const parsed = auditEventQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    )
    if (!parsed.success) return zodError(parsed)
    const result = await auditQueryService.exportCsv(
      {
        workspaceId: identity.workspaceId,
        memberId: identity.memberId,
        clerkId: identity.clerkId,
      },
      parsed.data
    )
    const day = new Date().toISOString().slice(0, 10)
    const slug = identity.workspaceSlug.replace(/[^a-zA-Z0-9-]/g, '')
    return new NextResponse(result.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="lumo-audit-log-${slug}-${day}.csv"`,
        'Cache-Control': 'no-store',
        'X-Audit-Row-Count': String(result.rowCount),
        'X-Audit-Truncated': String(result.truncated),
      },
    })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[GET /api/workspaces/me/audit-events/export]'
    )
  }
}
