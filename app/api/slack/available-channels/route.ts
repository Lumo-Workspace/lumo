import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    if (!workspaceUrl)
      return NextResponse.json(
        { error: 'workspaceUrl is required' },
        { status: 400 }
      )

    const ws = await getUserWorkspace(userId)
    if (!ws || ws.workspace.slug !== workspaceUrl)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const integration = await prisma.slackIntegration.findUnique({
      where: { workspaceId: ws.workspaceId },
      select: { accessToken: true },
    })
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
    if (!data.ok)
      return NextResponse.json(
        { error: 'Failed to fetch channels from Slack' },
        { status: 502 }
      )

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
