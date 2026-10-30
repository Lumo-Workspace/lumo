import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { memberAuditContext } from '@/lib/api/audit-context'
import { logger } from '@/lib/logger'
import {
  disconnectAccount,
  getAccountStatus,
} from '@/lib/services/feishu-integration.service'

/** LUM-1341 — the signed-in member's own Feishu account link. */

async function resolveMember(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const ws = await requireWorkspaceByUrl(
    authResult.userId,
    request.nextUrl.searchParams.get('workspaceUrl')
  )
  if (ws instanceof NextResponse) return ws
  return { userId: authResult.userId, ws }
}

export async function GET(request: NextRequest) {
  const ctx = await resolveMember(request)
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json(
    await getAccountStatus(ctx.ws.workspaceId, ctx.ws.member.id)
  )
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveMember(request)
  if (ctx instanceof NextResponse) return ctx
  try {
    await disconnectAccount(
      ctx.ws.workspaceId,
      ctx.ws.member.id,
      memberAuditContext(request.headers, {
        clerkId: ctx.userId,
        memberId: ctx.ws.member.id,
      })
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    logger.error(`[feishu/account] DELETE failed: ${String(error)}`)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
