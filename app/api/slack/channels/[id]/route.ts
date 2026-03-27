import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { SlackEventType } from '@/lib/slack/types'

type Params = { params: Promise<{ id: string }> }

async function getChannelAndVerify(channelRecordId: string, userId: string) {
  const ws = await getUserWorkspace(userId)
  if (!ws) return null

  const channel = await prisma.slackChannel.findUnique({
    where: { id: channelRecordId },
    include: { integration: { select: { workspaceId: true } } },
  })
  if (!channel || channel.integration.workspaceId !== ws.workspaceId)
    return null
  return channel
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const channel = await getChannelAndVerify(id, userId)
    if (!channel)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json()
    const events: SlackEventType[] = body.events ?? channel.events

    const updated = await prisma.slackChannel.update({
      where: { id },
      data: { events },
      select: { id: true, channelId: true, channelName: true, events: true },
    })
    return NextResponse.json({ channel: updated })
  } catch (error) {
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

    const channel = await getChannelAndVerify(id, userId)
    if (!channel)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.slackChannel.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/slack/channels/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
