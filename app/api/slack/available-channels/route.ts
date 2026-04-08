import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { decrypt } from '@/lib/crypto'
import { slackService } from '@/lib/services/slack.service'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const integration = await slackService
      .requireIntegrationWithToken(ws.workspaceId)
      .catch(() => null)
    if (!integration)
      return NextResponse.json({ error: 'Not connected' }, { status: 404 })

    const token = decrypt(integration.accessToken)
    const res = await fetch(
      'https://slack.com/api/conversations.list?exclude_archived=true&types=public_channel,private_channel&limit=200',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    )
    const data = await res.json()
    if (!data.ok) {
      console.error(
        '[slack available-channels] conversations.list error:',
        data.error
      )
      return NextResponse.json(
        {
          error: 'Failed to fetch channels from Slack',
          slackError: data.error,
        },
        { status: 502 }
      )
    }

    const channels = (
      data.channels as Array<{
        id: string
        name: string
        is_private: boolean
      }>
    ).map(c => ({
      id: c.id,
      name: `#${c.name}`,
      private: c.is_private,
    }))

    return NextResponse.json({ channels })
  } catch (error) {
    console.error('GET /api/slack/available-channels error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
