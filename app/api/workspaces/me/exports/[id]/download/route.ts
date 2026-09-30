import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, serviceErrorResponse } from '@/lib/api/helpers'
import { workspaceExportService } from '@/lib/services'

/**
 * GET /api/workspaces/me/exports/[id]/download — stream a READY export's zip
 * from its private blob (OWNER only, LUM-858). 410 once the download window
 * has closed. Every successful download is recorded on the export.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const ws = await requireUserWorkspace(authResult.userId)
    if (ws instanceof NextResponse) return ws
    const { id } = await params

    const archive = await workspaceExportService.openDownload({
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.workspace.slug,
      role: ws.member.role,
      clerkId: authResult.userId,
      exportId: id,
    })
    return new NextResponse(archive.stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(archive.size),
        'Content-Disposition': `attachment; filename="${archive.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[GET /api/workspaces/me/exports/[id]/download]'
    )
  }
}
