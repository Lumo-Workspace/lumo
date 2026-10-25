import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { memberAuditContext } from '@/lib/api/audit-context'
import { logger } from '@/lib/logger'
import { codeupService } from '@/lib/services/codeup.service'
import { updateCodeupRepositoriesSchema } from '@/lib/validation/codeup.schema'

/** LUM-1315 — the Codeup repositories a workspace confirmed (dogfood). */

function errorResponse(error: unknown, where: string) {
  const status = (error as { status?: number }).status ?? 500
  if ([400, 403, 404, 502].includes(status)) {
    return NextResponse.json({ error: (error as Error).message }, { status })
  }
  logger.error(`[codeup/repositories] ${where} error: ${String(error)}`)
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

/** GET — the organization's repositories, each marked confirmed or not. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveMember(request)
    if (ctx instanceof NextResponse) return ctx
    const repositories = await codeupService.listRepositories(ctx.workspaceId)
    return NextResponse.json({ repositories })
  } catch (error) {
    return errorResponse(error, 'GET')
  }
}

/** PUT — replace the confirmed set (owner only). */
export async function PUT(request: NextRequest) {
  try {
    const ctx = await resolveMember(request)
    if (ctx instanceof NextResponse) return ctx
    const parsed = updateCodeupRepositoriesSchema.safeParse(
      await request.json()
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', issues: parsed.error.issues },
        { status: 400 }
      )
    }
    const status = await codeupService.updateRepositories(
      ctx.workspaceId,
      ctx.member.role,
      parsed.data.repositoryIds,
      memberAuditContext(request.headers, {
        clerkId: ctx.userId,
        memberId: ctx.member.id,
      })
    )
    return NextResponse.json(status)
  } catch (error) {
    return errorResponse(error, 'PUT')
  }
}
