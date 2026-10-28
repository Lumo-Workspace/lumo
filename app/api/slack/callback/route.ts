import { NextRequest, NextResponse } from 'next/server'
import { requireIntegrationConfigured } from '@/lib/api/integration-configured'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'
import { decodeOauthState } from '@/lib/integrations/oauth-state'
import { logger } from '@/lib/logger'
import { slackService } from '@/lib/services/slack.service'
import { memberAuditContext } from '@/lib/api/audit-context'
import { resolveAppUrl } from '@/lib/config/public-config'

/**
 * GET /api/slack/callback?code={code}&state={state}
 *
 * The token is bound to the signed-in member, and only when that member is the
 * one who started the flow: a captured `state` replayed in someone else's
 * browser must not attach their Slack workspace to the attacker's Lumo
 * workspace (LUM-982). The state also expires (see lib/integrations/oauth-state).
 */
export async function GET(request: NextRequest) {
  // LUM-1025: not configured on this deployment → 404, never a 500.
  const notConfigured = requireIntegrationConfigured('slack')
  if (notConfigured) return notConfigured
  const code = request.nextUrl.searchParams.get('code')
  const stateParam = request.nextUrl.searchParams.get('state')
  const error = request.nextUrl.searchParams.get('error')
  const appUrl = resolveAppUrl() ?? ''

  // Handle user denial
  if (error || !code || !stateParam) {
    return NextResponse.redirect(`${appUrl}/?slack_error=1`)
  }

  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  // Resolve the workspace the flow was started from: the slug inside the
  // verified state, never one from the query string (LUM-989). An
  // undecodable state falls back to the default workspace only to pick
  // the settings page its error lands on.
  const decoded = decodeOauthState(stateParam)
  const ws = await getUserWorkspace(
    authResult.userId,
    decoded.ok ? decoded.payload.workspaceUrl : undefined
  )
  if (!ws) {
    return NextResponse.redirect(`${appUrl}/?slack_error=identity_mismatch`)
  }

  const settingsUrl = `${appUrl}/workspace/${ws.workspace.slug}/settings/integrations`

  if (!decoded.ok) {
    const reason = decoded.reason === 'expired' ? 'expired' : 'invalid_state'
    return NextResponse.redirect(`${settingsUrl}?slack_error=${reason}`)
  }
  const { workspaceId, memberId } = decoded.payload
  if (ws.workspaceId !== workspaceId || ws.member.id !== memberId) {
    return NextResponse.redirect(`${settingsUrl}?slack_error=identity_mismatch`)
  }

  try {
    const redirectUri = `${appUrl}/api/slack/callback`

    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
        redirect_uri: redirectUri,
      }),
    })

    const tokenData = await tokenRes.json()
    if (!tokenData.ok) {
      logger.error('[slack callback] token exchange failed:', tokenData.error)
      return NextResponse.redirect(`${settingsUrl}?slack_error=1`)
    }

    const encryptedToken = encrypt(tokenData.access_token)

    await slackService.upsertIntegration(
      {
        workspaceId,
        installedBy: memberId,
        accessToken: encryptedToken,
        slackTeamId: tokenData.team.id,
        slackTeamName: tokenData.team.name,
        slackUserId: tokenData.authed_user.id,
      },
      memberAuditContext(request.headers, { memberId })
    )

    return NextResponse.redirect(`${settingsUrl}?slack_connected=1`)
  } catch (error) {
    logger.error('GET /api/slack/callback error:', error)
    return NextResponse.redirect(`${settingsUrl}?slack_error=1`)
  }
}
