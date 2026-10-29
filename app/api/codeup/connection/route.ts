import { NextRequest, NextResponse } from 'next/server'
import { requireIntegrationConfigured } from '@/lib/api/integration-configured'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { memberAuditContext } from '@/lib/api/audit-context'
import { logger } from '@/lib/logger'
import { codeupService } from '@/lib/services/codeup.service'
import { connectCodeupSchema } from '@/lib/validation/codeup.schema'

/** LUM-1315 — the workspace's Codeup connection (dogfood). */

function errorResponse(error: unknown, where: string) {
  const status = (error as { status?: number }).status ?? 500
  if ([400, 403, 404, 502].includes(status)) {
    return NextResponse.json({ error: (error as Error).message }, { status })
  }
  logger.error(`[codeup/connection] ${where} error: ${String(error)}`)
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
}

async function resolveMember(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const ws = await requireWorkspaceByUrl(
    authResult.userId,
    request.nextUrl.searchParams.get('workspaceUrl')
  )
  if (ws instanceof NextResponse) return ws
  const member = await requireWorkspaceMember(ws.workspaceId, authResult.userId)
  if (member instanceof NextResponse) return member
  return { userId: authResult.userId, workspaceId: ws.workspaceId, member }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveMember(request)
    if (ctx instanceof NextResponse) return ctx
    return NextResponse.json(await codeupService.getStatus(ctx.workspaceId))
  } catch (error) {
    return errorResponse(error, 'GET')
  }
}

export async function POST(request: NextRequest) {
  const notConfigured = requireIntegrationConfigured('codeup')
  if (notConfigured) return notConfigured
  try {
    const ctx = await resolveMember(request)
    if (ctx instanceof NextResponse) return ctx
    const parsed = connectCodeupSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', issues: parsed.error.issues },
        { status: 400 }
      )
    }
    const repositories = await codeupService.connect(
      ctx.workspaceId,
      ctx.member.id,
      ctx.member.role,
      parsed.data,
      memberAuditContext(request.headers, {
        clerkId: ctx.userId,
        memberId: ctx.member.id,
      })
    )
    return NextResponse.json({ success: true, repositories })
  } catch (error) {
    return errorResponse(error, 'POST')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await resolveMember(request)
    if (ctx instanceof NextResponse) return ctx
    await codeupService.disconnect(
      ctx.workspaceId,
      ctx.member.role,
      memberAuditContext(request.headers, {
        clerkId: ctx.userId,
        memberId: ctx.member.id,
      })
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error, 'DELETE')
  }
}
