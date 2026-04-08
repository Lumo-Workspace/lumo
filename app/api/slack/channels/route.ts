import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { SlackEventType, ALL_SLACK_EVENTS } from '@/lib/slack/types'
import { isPrismaUniqueError, requireWorkspaceByUrl } from '@/lib/api/helpers'
import { slackService } from '@/lib/services/slack.service'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const projectId = request.nextUrl.searchParams.get('projectId')
    if (!projectId)
      return NextResponse.json(
        { error: 'workspaceUrl and projectId are required' },
        { status: 400 }
      )

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const channel = await slackService
      .getChannelForProject(ws.workspaceId, projectId)
      .catch((err: { status?: number }) => {
        if (err.status === 404) return null
        throw err
      })

    return NextResponse.json({ channel: channel ?? null })
  } catch (error) {
    console.error('GET /api/slack/channels error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const body = await request.json()
    const channelId: string = body.channelId ?? ''
    const channelName: string = body.channelName ?? ''
    const projectId: string = body.projectId ?? ''
    const rawEvents: unknown[] = Array.isArray(body.events)
      ? body.events
      : ALL_SLACK_EVENTS
    const events = rawEvents.filter((e): e is SlackEventType =>
      ALL_SLACK_EVENTS.includes(e as SlackEventType)
    )

    if (!channelId || !channelName || !projectId)
      return NextResponse.json(
        { error: 'channelId, channelName, and projectId are required' },
        { status: 400 }
      )
    if (events.length === 0)
      return NextResponse.json(
        { error: 'At least one valid event is required' },
        { status: 400 }
      )

    const channel = await slackService.createChannel(ws.workspaceId, {
      channelId,
      channelName,
      projectId,
      events,
    })

    return NextResponse.json({ channel }, { status: 201 })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 404) {
      return NextResponse.json({ error: 'Not connected' }, { status: 404 })
    }
    if (status === 403) {
      return NextResponse.json({ error: 'Project not found' }, { status: 403 })
    }
    if (status === 409 || isPrismaUniqueError(error)) {
      return NextResponse.json(
        { error: 'Channel already configured for this project' },
        { status: 409 }
      )
    }
    console.error('POST /api/slack/channels error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
