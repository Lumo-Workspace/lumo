import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, serviceErrorResponse } from '@/lib/api/helpers'
import { workspaceExportService } from '@/lib/services'

/**
 * GET /api/workspaces/me/exports — recent GDPR data exports of the caller's
 * workspace (OWNER only, LUM-858).
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const ws = await requireUserWorkspace(authResult.userId)
    if (ws instanceof NextResponse) return ws

    const exports = await workspaceExportService.listExports(
      ws.workspaceId,
      ws.member.role
    )
    return NextResponse.json({ exports })
  } catch (error) {
    return serviceErrorResponse(error, '[GET /api/workspaces/me/exports]')
  }
}

/**
 * POST /api/workspaces/me/exports — start a workspace export (OWNER only).
 * 202 with the new export; 200 with the one already in progress.
 */
export async function POST() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const ws = await requireUserWorkspace(authResult.userId)
    if (ws instanceof NextResponse) return ws

    const result = await workspaceExportService.requestExport({
      workspaceId: ws.workspaceId,
      role: ws.member.role,
      clerkId: authResult.userId,
    })
    return NextResponse.json(
      { export: result.export, started: result.started },
      { status: result.started ? 202 : 200 }
    )
  } catch (error) {
    return serviceErrorResponse(error, '[POST /api/workspaces/me/exports]')
  }
}
