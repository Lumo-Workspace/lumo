import { NextRequest, NextResponse } from 'next/server'
import { requireIntegrationConfigured } from '@/lib/api/integration-configured'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'
import { decodeOauthState } from '@/lib/integrations/oauth-state'
import { logger } from '@/lib/logger'
import { memberAuditContext } from '@/lib/api/audit-context'
import { githubService } from '@/lib/services/github.service'

/**
 * GET /api/github/callback?code={code}&state={state}
 * Handles the OAuth callback from GitHub.
 *
 * The token is bound to the signed-in member, and only when that member is the
 * one who started the flow: a captured `state` replayed in someone else's
 * browser must not link their GitHub account to the attacker's member
 * (LUM-982). The state also expires (see lib/integrations/oauth-state).
 */
export async function GET(request: NextRequest) {
  // LUM-1025: not configured on this deployment → 404, never a 500.
  const notConfigured = requireIntegrationConfigured('githubAccount')
  if (notConfigured) return notConfigured
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/?github_error=1`)
  }

  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  // Resolve the workspace the flow was started from: the slug inside the
  // verified state, never one from the query string (LUM-989). An
  // undecodable state falls back to the default workspace only to pick
  // the settings page its error lands on.
  const decoded = decodeOauthState(state)
  const ws = await getUserWorkspace(
    authResult.userId,
    decoded.ok ? decoded.payload.workspaceUrl : undefined
  )
  if (!ws) {
    return NextResponse.redirect(`${appUrl}/?github_error=identity_mismatch`)
  }

  const settingsUrl = `${appUrl}/workspace/${ws.workspace.slug}/settings/integrations`
  const errorRedirect = `${settingsUrl}?github_error=1`

  if (!decoded.ok) {
    const reason = decoded.reason === 'expired' ? 'expired' : 'invalid_state'
    return NextResponse.redirect(`${settingsUrl}?github_error=${reason}`)
  }
  const { workspaceId, memberId } = decoded.payload
  if (ws.workspaceId !== workspaceId || ws.member.id !== memberId) {
    return NextResponse.redirect(
      `${settingsUrl}?github_error=identity_mismatch`
    )
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/github/callback`,
        }),
      }
    )

    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      // Log only the error fields — never the response body wholesale.
      logger.error(
        '[github/callback] No access_token in response:',
        tokenData.error ?? 'unknown_error'
      )
      return NextResponse.redirect(errorRedirect)
    }

    const rawToken: string = tokenData.access_token
    const tokenType: string = tokenData.token_type ?? 'oauth'

    // Fetch GitHub user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${rawToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!userRes.ok) {
      logger.error('[github/callback] Failed to fetch GitHub user')
      return NextResponse.redirect(errorRedirect)
    }

    const ghUser = await userRes.json()
    const githubUserId = String(ghUser.id)
    const githubLogin: string = ghUser.login

    // Encrypt the access token before storing
    const encryptedToken = encrypt(rawToken)

    await githubService.upsertIntegration(
      {
        workspaceId,
        memberId,
        accessToken: encryptedToken,
        tokenType,
        githubUserId,
        githubLogin,
      },
      memberAuditContext(request.headers, {
        clerkId: authResult.userId,
        memberId,
      })
    )

    return NextResponse.redirect(settingsUrl)
  } catch (error) {
    logger.error('[github/callback] Error:', error)
    return NextResponse.redirect(errorRedirect)
  }
}
