import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'

/**
 * Invite a single Clerk user (by clerkId) to a Slack channel.
 * Resolves their Slack user ID via primary email. Best-effort — never throws.
 */
async function inviteUserToChannel(
  clerkId: string,
  channelId: string,
  token: string
): Promise<void> {
  try {
    const { createClerkClient } = await import('@clerk/nextjs/server')
    const clerk = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY!,
    })
    const user = await clerk.users.getUser(clerkId)
    const email = user.emailAddresses.find(
      e => e.id === user.primaryEmailAddressId
    )?.emailAddress
    if (!email) return

    const lookupRes = await fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const lookupData = await lookupRes.json()
    if (!lookupData.ok) return
    const slackUserId: string = lookupData.user?.id
    if (!slackUserId) return

    const inviteRes = await fetch(
      'https://slack.com/api/conversations.invite',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: channelId, users: slackUserId }),
      }
    )
    const inviteData = await inviteRes.json()
    if (!inviteData.ok && inviteData.error !== 'already_in_channel') {
      console.error(
        '[slack create-channel] conversations.invite error:',
        inviteData.error
      )
    }
  } catch (err) {
    console.error('[slack create-channel] inviteUserToChannel error:', err)
  }
}

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

    const integration = await prisma.slackIntegration.findUnique({
      where: { workspaceId: ws.workspaceId },
      select: { accessToken: true },
    })
    if (!integration)
      return NextResponse.json(
        { error: 'Slack not connected' },
        { status: 404 }
      )

    const token = decrypt(integration.accessToken)

    const res = await fetch('https://slack.com/api/conversations.create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, is_private: isPrivate }),
    })
    const data = await res.json()

    if (!data.ok) {
      console.error(
        '[slack create-channel] conversations.create error:',
        data.error
      )

      // Provide a user-friendly message for common errors
      let message = 'Failed to create Slack channel'
      if (data.error === 'name_taken')
        message = `A channel named #${name} already exists in Slack`
      else if (data.error === 'missing_scope')
        message =
          'Missing Slack permission. Add channels:manage (or groups:write for private) to your app scopes and reinstall.'
      else if (
        data.error === 'invalid_name' ||
        data.error === 'invalid_name_specials'
      )
        message = `"${name}" is not a valid Slack channel name`

      return NextResponse.json(
        { error: message, slackError: data.error },
        { status: 422 }
      )
    }

    const channel = data.channel as {
      id: string
      name: string
      is_private: boolean
    }

    // Invite the current user (project owner) to the new channel (fire-and-forget)
    inviteUserToChannel(userId, channel.id, token).catch(err =>
      console.error('[slack create-channel] invite user error:', err)
    )

    return NextResponse.json({
      channel: {
        id: channel.id,
        name: `#${channel.name}`,
        private: channel.is_private,
      },
    })
  } catch (error) {
    console.error('POST /api/slack/create-channel error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
