import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { encrypt, decrypt } from '@/lib/crypto'

/**
 * GET /api/github/callback?code={code}&state={state}
 * Handles the OAuth callback from GitHub.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code || !state) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?github_error=1`
    )
  }

  let memberId: string
  let workspaceId: string
  let workspaceUrl: string

  try {
    const parsed = JSON.parse(decrypt(state)) as {
      memberId: string
      workspaceId: string
      workspaceUrl: string
    }
    memberId = parsed.memberId
    workspaceId = parsed.workspaceId
    workspaceUrl = parsed.workspaceUrl
  } catch {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?github_error=1`
    )
  }

  const errorRedirect = `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceUrl}/settings/integrations?github_error=1`
  const successRedirect = `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceUrl}/settings/integrations`

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
      console.error('[github/callback] No access_token in response:', tokenData)
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
      console.error('[github/callback] Failed to fetch GitHub user')
      return NextResponse.redirect(errorRedirect)
    }

    const ghUser = await userRes.json()
    const githubUserId = String(ghUser.id)
    const githubLogin: string = ghUser.login

    // Encrypt the access token before storing
    const encryptedToken = encrypt(rawToken)

    await prisma.gitHubIntegration.upsert({
      where: { workspaceId_memberId: { workspaceId, memberId } },
      create: {
        workspaceId,
        memberId,
        accessToken: encryptedToken,
        tokenType,
        githubUserId,
        githubLogin,
        repositories: [],
      },
      update: {
        accessToken: encryptedToken,
        tokenType,
        githubUserId,
        githubLogin,
      },
    })

    return NextResponse.redirect(successRedirect)
  } catch (error) {
    console.error('[github/callback] Error:', error)
    return NextResponse.redirect(errorRedirect)
  }
}
