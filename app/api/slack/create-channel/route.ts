import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { slackService } from '@/lib/services/slack.service'

/**
 * POST /api/slack/create-channel?workspaceUrl=...
 * Body: { name: string; isPrivate?: boolean }
 *
 * Creates a new channel in Slack via conversations.create and returns
 * the new channel's { id, name } so the caller can immediately select it.
 *
 * Required bot scopes: channels:manage (public) or groups:write (private)
 */
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
    const rawName: string = (body.name ?? '').trim().toLowerCase()
    const isPrivate: boolean = body.isPrivate === true

    // Slack channel name rules: lowercase, no spaces, max 80 chars, alphanumeric + hyphens
    const name = rawName.replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '')
    if (!name)
      return NextResponse.json(
        { error: 'Channel name is required' },
        { status: 400 }
      )
    if (name.length > 80)
      return NextResponse.json(
        { error: 'Channel name must be 80 characters or fewer' },
        { status: 400 }
      )

    const channel = await slackService.createChannelWithInvite(
      ws.workspaceId,
      name,
      isPrivate,
      userId
    )

    return NextResponse.json({ channel })
  } catch (error) {
    const err = error as Error & {
      status?: number
      slackError?: string
      code?: string
    }
    if (err.status === 422) {
      return NextResponse.json(
        {
          error: err.message,
          slackError: err.slackError,
          ...(err.code ? { code: err.code } : {}),
        },
        { status: 422 }
      )
    }
    if (err.status === 404) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    console.error('POST /api/slack/create-channel error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
