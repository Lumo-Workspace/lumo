import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { decrypt, encrypt } from '@/lib/crypto'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const stateParam = request.nextUrl.searchParams.get('state')
  const error = request.nextUrl.searchParams.get('error')

  // Handle user denial
  if (error) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?slack_error=1`
    )
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?slack_error=1`
    )
  }

  try {
    const { workspaceId, memberId, workspaceUrl } = JSON.parse(
      decrypt(stateParam)
    ) as {
      workspaceId: string
      memberId: string
      workspaceUrl: string
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/slack/callback`

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
      console.error('[slack callback] token exchange failed:', tokenData.error)
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceUrl}/settings/integrations?slack_error=1`
      )
    }

    const encryptedToken = encrypt(tokenData.access_token)

    await prisma.slackIntegration.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        installedBy: memberId,
        accessToken: encryptedToken,
        slackTeamId: tokenData.team.id,
        slackTeamName: tokenData.team.name,
        slackUserId: tokenData.authed_user.id,
      },
      update: {
        installedBy: memberId,
        accessToken: encryptedToken,
        slackTeamId: tokenData.team.id,
        slackTeamName: tokenData.team.name,
        slackUserId: tokenData.authed_user.id,
      },
    })

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceUrl}/settings/integrations?slack_connected=1`
    )
  } catch (error) {
    console.error('GET /api/slack/callback error:', error)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/?slack_error=1`
    )
  }
}
