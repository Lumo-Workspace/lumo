import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { encodeOauthState } from '@/lib/integrations/oauth-state'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { logger } from '@/lib/logger'
import { resolveAppUrl } from '@/lib/config/public-config'

/**
 * GET /api/github/app/reverify?workspaceUrl={slug}
 *
 * LUM-881 — re-check the workspace's GitHub App installation. Repositories
 * added to the installation after it was bound stay pending, and access a
 * member has since lost is not noticed, until someone who can read them
 * vouches again. This sends a workspace owner through the same GitHub
 * authorization as the install callback; /api/github/app/callback then
 * recomputes the confirmed repositories from what GitHub says they can read.
 *
 * A full-page navigation from the settings card, so every refusal redirects
 * back to the card with a toast code rather than rendering JSON.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
  // A full-page redirect carries no X-Lumo-Workspace header (LUM-989).
  const ws = await getUserWorkspace(userId, workspaceUrl)
  if (!ws || !workspaceUrl || ws.workspace.slug !== workspaceUrl) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const settingsUrl = `${resolveAppUrl()}/workspace/${encodeURIComponent(ws.workspace.slug)}/settings/integrations`

  try {
    const installationId = await githubAppInstallService.startReverify(
      ws.workspaceId,
      ws.member.role
    )
    // Expiring and member-bound like every other integration state (LUM-991).
    const state = encodeOauthState({
      workspaceId: ws.workspaceId,
      workspaceUrl: ws.workspace.slug,
      memberId: ws.member.id,
      installationId,
      mode: 'reverify',
      purpose: 'github-app',
    })
    return NextResponse.redirect(
      githubAppInstallService.userAuthorizeUrl(
        state,
        `${resolveAppUrl()}/api/github/app/callback`
      )
    )
  } catch (error) {
    logger.error(
      `[github/app/reverify] cannot start re-verification for workspace ${ws.workspaceId}: ${String(error)}`
    )
    const reason = (error as { code?: string }).code
    const code =
      reason === 'not_owner' || reason === 'verify_not_configured'
        ? reason
        : 'reverify_failed'
    return NextResponse.redirect(`${settingsUrl}?github_app_error=${code}`)
  }
}
