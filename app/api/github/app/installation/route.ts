import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { githubAppInstallService } from '@/lib/services'
import { logger } from '@/lib/logger'

/**
 * GET /api/github/app/installation?workspaceUrl={slug}
 * Whether the workspace has the Lumo GitHub App installed — the state the
 * managed security scan actually depends on, reported separately from the
 * OAuth connection so the settings card can tell the two apart.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    return NextResponse.json(
      await githubAppInstallService.getStatus(ws.workspaceId)
    )
  } catch (error) {
    logger.error(`GET /api/github/app/installation error: ${String(error)}`)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/github/app/installation?workspaceUrl={slug}
 * Uninstalls the App for this workspace (and drops our record of it).
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    await githubAppInstallService.uninstall(ws.workspaceId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error(`DELETE /api/github/app/installation error: ${String(error)}`)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
