import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { decodeOauthState } from '@/lib/integrations/oauth-state'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { logger } from '@/lib/logger'
import { memberAuditContext } from '@/lib/api/audit-context'

const ERROR_CODES = new Set([
  'verify_not_configured',
  'not_authorized',
  'repo_access_incomplete',
  'too_many_repositories',
  'not_owner',
])

/**
 * GET /api/github/app/callback?code={code}&state={state}
 *
 * LUM-875 — second leg of the install callback. /api/github/app/setup sent the
 * user to authorize the Lumo GitHub App; GitHub returns here with a code for
 * that user. The installation from the signed state is recorded only when
 * GitHub lists it among the installations this user can access — the
 * `installation_id` on the setup URL is attacker-controlled on its own.
 * It must also be able to read every repository in it (LUM-880), or the
 * callback redirects with `repo_access_incomplete`.
 *
 * With `mode: 'reverify'` in the state (LUM-881) the same authorization
 * instead re-checks an existing installation: the workspace keeps exactly the
 * repositories this owner can read.
 *
 * Membership of the state's workspace is re-checked here: the state names the
 * workspace, the signed-in caller must belong to it — and be the member who
 * started the flow. The state expires after OAUTH_STATE_TTL_MS (LUM-991).
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
  const state = decoded?.ok ? decoded.payload : null
  // The callback leg always names an installation (install and reverify).
  const installationId = state?.installationId
  if (!state || installationId === undefined) {
    return NextResponse.json(
      {
        error:
          decoded?.ok === false && decoded.reason === 'expired'
            ? 'This installation link has expired. Start again from your workspace integration settings.'
            : 'This installation link is missing or invalid. Start the installation from your workspace integration settings.',
      },
      { status: 400 }
    )
  }

  // The slug comes from the signed state, never the query string (LUM-989).
  // Only the member who started the flow may finish it (LUM-991).
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
  const settingsUrl = `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${encodeURIComponent(ws.workspace.slug)}/settings/integrations`

  // No code means the user declined to authorize (`error=access_denied`):
  // without GitHub vouching for them there is nothing we may record.
  const code = searchParams.get('code')
  if (!code) {
    return NextResponse.redirect(
      `${settingsUrl}?github_app_error=not_authorized`
    )
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/github/app/callback`
  const audit = memberAuditContext(request.headers, {
    clerkId: userId,
    memberId: ws.member.id,
  })
  const reverify = state.mode === 'reverify'

  try {
    if (reverify) {
      await githubAppInstallService.reverify({
        workspaceId: ws.workspaceId,
        memberRole: ws.member.role,
        userCode: code,
        redirectUri,
        audit,
      })
    } else {
      await githubAppInstallService.install({
        workspaceId: ws.workspaceId,
        memberId: ws.member.id,
        installationId,
        userCode: code,
        redirectUri,
        audit,
      })
    }
  } catch (error) {
    logger.error(
      `[github/app/callback] refused installation ${installationId} for workspace ${ws.workspaceId}: ${String(error)}`
    )
    const reason = (error as { code?: string }).code
    const errorCode =
      reason && ERROR_CODES.has(reason)
        ? reason
        : reverify
          ? 'reverify_failed'
          : 'install_failed'
    return NextResponse.redirect(`${settingsUrl}?github_app_error=${errorCode}`)
  }

  return NextResponse.redirect(
    `${settingsUrl}?github_app=${reverify ? 'reverified' : 'installed'}`
  )
}
