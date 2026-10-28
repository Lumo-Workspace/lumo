import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { encodeOauthState } from '@/lib/integrations/oauth-state'
import { logger } from '@/lib/logger'
import { integrationConfigStatus } from '@/lib/integrations/configured'
import { resolveAppUrl } from '@/lib/config/public-config'

/**
 * GET /api/github/app/install?workspaceUrl={slug}
 *
 * Starts the GitHub App installation by redirecting to the App's install page,
 * carrying an encrypted state that names the workspace the installation should
 * land on. GitHub hands that state back to /api/github/app/setup, which still
 * re-checks the caller's membership — the state carries context, not authority.
 * The state expires after OAUTH_STATE_TTL_MS and only the member who started
 * the flow can complete it, and only the App legs accept it (LUM-991).
 *
 * Separate from /api/github/oauth on purpose: OAuth authorizes a person (repo
 * listing, PR links, repo webhooks), the App installation authorizes a machine
 * identity scoped to `contents:read` that the managed security scan clones with.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
  if (!workspaceUrl) {
    return NextResponse.json(
      { error: 'workspaceUrl is required' },
      { status: 400 }
    )
  }

  // A full-page redirect carries no X-Lumo-Workspace header, so name the
  // workspace explicitly; the slug check still refuses a single-workspace
  // user asking for someone else's workspace (LUM-989).
  const ws = await getUserWorkspace(userId, workspaceUrl)
  if (!ws || ws.workspace.slug !== workspaceUrl) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // A missing slug is a deployment problem, not the owner's. This is a
  // full-page navigation from the Install button, so a JSON error would be the
  // whole page; send them back to the card with a toast that names the fix.
  // LUM-1025: the slug alone is not enough — the setup leg mints tokens and
  // verifies the installer, so the whole App must be configured.
  const appSlug = process.env.GITHUB_APP_SLUG
  const status = integrationConfigStatus('github')
  if (!appSlug || !status.configured) {
    logger.error(
      `[github/app/install] the GitHub App is not configured (missing: ${status.missing.join(', ')}) — the install button cannot work until it is`
    )
    // A deployment without the App may lack NEXT_PUBLIC_APP_URL too; an
    // `undefined/…` redirect would throw, so fall back to the request origin.
    const base = resolveAppUrl() || request.nextUrl.origin
    return NextResponse.redirect(
      `${base}/workspace/${workspaceUrl}/settings/integrations?github_app_error=not_configured`
    )
  }

  const state = encodeOauthState({
    memberId: ws.member.id,
    workspaceId: ws.workspaceId,
    workspaceUrl,
    purpose: 'github-app',
  })

  return NextResponse.redirect(
    `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(state)}`
  )
}
