import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { SlackEventType, ALL_SLACK_EVENTS } from '@/lib/slack/types'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    const projectId = request.nextUrl.searchParams.get('projectId')
    if (!workspaceUrl || !projectId)
      return NextResponse.json(
        { error: 'workspaceUrl and projectId are required' },
        { status: 400 }
      )

    const ws = await getUserWorkspace(userId)
    if (!ws || ws.workspace.slug !== workspaceUrl)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const integration = await prisma.slackIntegration.findUnique({
      where: { workspaceId: ws.workspaceId },
      select: { id: true },
    })
    if (!integration)
      return NextResponse.json({ error: 'Not connected' }, { status: 404 })

    const channel = await prisma.slackChannel.findFirst({
      where: { integrationId: integration.id, projectId },
      select: { id: true, channelId: true, channelName: true, events: true },
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

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    if (!workspaceUrl)
      return NextResponse.json(
        { error: 'workspaceUrl is required' },
        { status: 400 }
      )

    const ws = await getUserWorkspace(userId)
    if (!ws || ws.workspace.slug !== workspaceUrl)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

    // Verify project belongs to this workspace
    const project = await prisma.project.findFirst({
      where: { id: projectId, workspaceId: ws.workspaceId },
    })
    if (!project)
      return NextResponse.json({ error: 'Project not found' }, { status: 403 })

    const integration = await prisma.slackIntegration.findUnique({
      where: { workspaceId: ws.workspaceId },
      select: { id: true },
    })
    if (!integration)
      return NextResponse.json({ error: 'Not connected' }, { status: 404 })

    // App-level check before DB insert
    const existing = await prisma.slackChannel.findFirst({
      where: { integrationId: integration.id, projectId },
    })
    if (existing)
      return NextResponse.json(
        { error: 'Channel already configured for this project' },
        { status: 409 }
      )

    const channel = await prisma.slackChannel.create({
      data: {
        integrationId: integration.id,
        channelId,
        channelName,
        events,
        projectId,
      },
      select: {
        id: true,
        channelId: true,
        channelName: true,
        events: true,
        projectId: true,
      },
    })

    return NextResponse.json({ channel }, { status: 201 })
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
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
