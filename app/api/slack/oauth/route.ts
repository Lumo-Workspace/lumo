import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'

const SLACK_SCOPES = [
  'chat:write',
  'channels:read',
  'users:read',
  'users:read.email',
  'app_mentions:read',
  'commands',
  'im:write',
].join(',')

export async function GET(request: NextRequest) {
  try {
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

    const ws = await getUserWorkspace(userId)
    if (!ws || ws.workspace.slug !== workspaceUrl) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const state = encrypt(
      JSON.stringify({
        workspaceId: ws.workspaceId,
        memberId: ws.member.id,
        workspaceUrl,
      })
    )
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/slack/callback`

    const params = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      scope: SLACK_SCOPES,
      redirect_uri: redirectUri,
      state,
    })

    return NextResponse.redirect(
      `https://slack.com/oauth/v2/authorize?${params}`
    )
  } catch (error) {
    console.error('GET /api/slack/oauth error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
