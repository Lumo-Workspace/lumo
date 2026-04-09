import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { SlackEventType, ALL_SLACK_EVENTS } from '@/lib/slack/types'
import { slackService } from '@/lib/services/slack.service'
import { slackRepository } from '@/lib/repositories/slack.repository'

type Params = { params: Promise<{ id: string }> }

async function getWorkspaceId(userId: string): Promise<string | null> {
  const ws = await getUserWorkspace(userId)
  return ws?.workspaceId ?? null
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const workspaceId = await getWorkspaceId(userId)
    if (!workspaceId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Need to read current events for fallback before update
    const existingChannel = await slackRepository.findChannelWithIntegration(id)
    if (
      !existingChannel ||
      existingChannel.integration.workspaceId !== workspaceId
    )
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json()
    const rawEvents: unknown[] = Array.isArray(body.events)
      ? body.events
      : existingChannel.events
    const events = rawEvents.filter((e): e is SlackEventType =>
      ALL_SLACK_EVENTS.includes(e as SlackEventType)
    )

    const updated = await slackService.updateChannel(id, workspaceId, {
      ...(body.channelId ? { channelId: body.channelId } : {}),
      ...(body.channelName ? { channelName: body.channelName } : {}),
      events,
    })
    return NextResponse.json({ channel: updated })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 404) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    console.error('PATCH /api/slack/channels/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const workspaceId = await getWorkspaceId(userId)
    if (!workspaceId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await slackService.deleteChannel(id, workspaceId)
    return NextResponse.json({ success: true })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 404) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    console.error('DELETE /api/slack/channels/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
