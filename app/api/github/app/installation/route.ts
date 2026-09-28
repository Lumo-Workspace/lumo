import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
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

    const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    // Pending repository names are owner-only (LUM-883).
    return NextResponse.json(
      await githubAppInstallService.getStatus(ws.workspaceId, memberResult.role)
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
 *
 * Owner-only. Workspace membership is not enough: the installation is what the
 * managed security scan clones with, so any member could otherwise switch
 * scanning off for the entire team.
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

    const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    await githubAppInstallService.uninstall(ws.workspaceId, memberResult.role)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if ((error as { status?: number }).status === 403) {
      return NextResponse.json(
        { error: 'Only workspace owners can uninstall the GitHub App' },
        { status: 403 }
      )
    }
    logger.error(`DELETE /api/github/app/installation error: ${String(error)}`)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
