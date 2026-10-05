import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { sentryService } from '@/lib/services/sentry.service'
import { memberAuditContext } from '@/lib/api/audit-context'
import { logger } from '@/lib/logger'

function errorStatus(err: unknown): number {
  return (err as { status?: number }).status ?? 500
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params

    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    await sentryService.deleteMapping(
      ws.workspaceId,
      memberResult.role,
      id,
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: memberResult.id,
      })
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    const status = errorStatus(error)
    if ([403, 404].includes(status)) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    logger.error('[sentry/mappings] DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
