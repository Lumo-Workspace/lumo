import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { memberAuditContext } from '@/lib/api/audit-context'
import { logger } from '@/lib/logger'
import {
  disconnectInstall,
  getInstallStatus,
} from '@/lib/services/feishu-integration.service'

/** LUM-1341 — the workspace's Feishu install: status (any member), disconnect (owner). */

async function resolveWorkspace(request: NextRequest) {
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
  const ctx = await resolveWorkspace(request)
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json(await getInstallStatus(ctx.ws.workspaceId))
}

export async function DELETE(request: NextRequest) {
  const ctx = await resolveWorkspace(request)
  if (ctx instanceof NextResponse) return ctx
  try {
    await disconnectInstall(
      ctx.ws.workspaceId,
      ctx.ws.member.role,
      memberAuditContext(request.headers, {
        clerkId: ctx.userId,
        memberId: ctx.ws.member.id,
      })
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 403 || status === 404) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    logger.error(`[feishu/integration] DELETE failed: ${String(error)}`)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
