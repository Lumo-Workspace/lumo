import { NextRequest, NextResponse } from 'next/server'
import { requireIntegrationConfigured } from '@/lib/api/integration-configured'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { encodeOauthState } from '@/lib/integrations/oauth-state'

const SLACK_SCOPES = [
  'chat:write',
  'channels:read',
  'channels:history', // LUM-44: read public-channel messages for task context
  'groups:read', // LUM-44: read private-channel metadata for task context
  'groups:history', // LUM-44: read private-channel messages for task context
  'users:read',
  'users:read.email',
  'app_mentions:read',
  'commands',
  'im:write',
  'channels:manage', // LUM-1080: conversations.create / invite — public channels
  'groups:write', // LUM-1080: the same for private channels
].join(',')

export async function GET(request: NextRequest) {
  // LUM-1025: not configured on this deployment → 404, never a 500.
  const notConfigured = requireIntegrationConfigured('slack')
  if (notConfigured) return notConfigured
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

    // A full-page redirect carries no X-Lumo-Workspace header, so name the
    // workspace explicitly; the slug check still refuses a single-workspace
    // user asking for someone else's workspace (LUM-989).
    const ws = await getUserWorkspace(userId, workspaceUrl)
    if (!ws || ws.workspace.slug !== workspaceUrl) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const state = encodeOauthState({
      workspaceId: ws.workspaceId,
      memberId: ws.member.id,
      workspaceUrl,
    })
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
