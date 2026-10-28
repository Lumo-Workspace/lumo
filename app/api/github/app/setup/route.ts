import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import {
  decodeOauthState,
  encodeOauthState,
} from '@/lib/integrations/oauth-state'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { logger } from '@/lib/logger'
import { resolveAppUrl } from '@/lib/config/public-config'

/**
 * GET /api/github/app/setup?installation_id={id}&setup_action={action}&state={state}
 *
 * Where GitHub sends the user back after installing (or updating) the Lumo
 * GitHub App, carrying the signed `state` we minted in /api/github/app/install.
 *
 * The state alone is not trusted for authorization — a user could replay
 * someone else's link — so it expires after OAUTH_STATE_TTL_MS and the
 * signed-in caller must be the very member who started the install, in the
 * workspace the state names (LUM-991). Nor is `installation_id`: GitHub documents it as
 * attacker-controlled, and the App can read any installation it has (LUM-875).
 * So this route writes nothing. It hands the user to GitHub to authorize the
 * App, and /api/github/app/callback records the installation only once GitHub
 * confirms this user can access it. Every failure is reported explicitly
 * rather than redirected away silently.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const { searchParams } = request.nextUrl
  const rawState = searchParams.get('state')
  // Only a state minted for the App legs — never a member OAuth state (LUM-991).
  const decoded = rawState
    ? decodeOauthState(rawState, Date.now(), 'github-app')
    : null
  if (!decoded?.ok) {
    return NextResponse.json(
      {
        error:
          decoded?.reason === 'expired'
            ? 'This installation link has expired. Start the installation again from your workspace integration settings.'
            : 'This installation link is missing or invalid. Start the installation from your workspace integration settings.',
      },
      { status: 400 }
    )
  }
  const state = decoded.payload

  // The slug comes from the signed state, never the query string (LUM-989).
  // Only the member who started the install may finish it (LUM-991).
  const ws = await getUserWorkspace(userId, state.workspaceUrl)
  if (
    !ws ||
    ws.workspaceId !== state.workspaceId ||
    ws.member.id !== state.memberId
  ) {
    return NextResponse.json(
      {
        error:
          'This installation was started by a different account or for a workspace you are not a member of. Start it again from your workspace integration settings.',
      },
      { status: 403 }
    )
  }

  // The redirect target comes from the membership lookup, never from the
  // state: the settings path is ours to decide, not the query string's.
  const settingsUrl = `${resolveAppUrl()}/workspace/${encodeURIComponent(ws.workspace.slug)}/settings/integrations`

  const installationId = Number(searchParams.get('installation_id'))
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return NextResponse.json(
      { error: 'GitHub did not return a valid installation id.' },
      { status: 400 }
    )
  }

  // `request` means the user asked an org owner to approve the install — there
  // is no installation to record yet.
  if (searchParams.get('setup_action') === 'request') {
    return NextResponse.redirect(`${settingsUrl}?github_app=requested`)
  }

  // A fresh state for the authorize leg: its TTL starts now (LUM-991).
  const verifyState = encodeOauthState({
    workspaceId: ws.workspaceId,
    workspaceUrl: ws.workspace.slug,
    memberId: ws.member.id,
    installationId,
    purpose: 'github-app',
  })

  try {
    return NextResponse.redirect(
      githubAppInstallService.userAuthorizeUrl(
        verifyState,
        `${resolveAppUrl()}/api/github/app/callback`
      )
    )
  } catch (error) {
    logger.error(
      `[github/app/setup] cannot verify installation ${installationId} for workspace ${ws.workspaceId}: ${String(error)}`
    )
    const code =
      (error as { code?: string }).code === 'verify_not_configured'
        ? 'verify_not_configured'
        : 'install_failed'
    return NextResponse.redirect(`${settingsUrl}?github_app_error=${code}`)
  }
}
