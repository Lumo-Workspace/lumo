import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { memberService } from '@/lib/services/member.service'
import { memberAuditContext } from '@/lib/api/audit-context'
import { logger } from '@/lib/logger'

/**
 * DELETE /api/workspaces/members/me
 * Removes the current user from their workspace (leave workspace): the
 * membership is deactivated (LUM-906), not deleted. Blocked if they are the
 * last OWNER.
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    await memberService.leaveWorkspace(
      ws.member.id,
      ws.member.role,
      ws.workspaceId,
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: ws.member.id,
      })
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    logger.error('DELETE /api/workspaces/members/me error', {
      error: (error as Error)?.message ?? String(error),
    })
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
