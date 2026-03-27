import { prisma } from '@/lib/db/prisma'
import { decrypt } from '@/lib/crypto'
import {
  SlackEventType,
  NotificationPayload,
  SLACK_EVENT_LABELS,
} from './types'

const EMOJI: Record<SlackEventType, string> = {
  task_created: '🆕',
  task_assigned: '👤',
  task_in_review: '🔍',
  task_done: '✅',
  task_sent_back: '↩️',
  pr_opened: '🔀',
  pr_merged: '🎉',
  comment_mention: '💬',
}

function buildBlocks(
  event: SlackEventType,
  payload: NotificationPayload
): object[] {
  const emoji = EMOJI[event]
  const label = SLACK_EVENT_LABELS[event]
  const url = payload.taskUrl

  const lines: string[] = [`${emoji} *${label}*`]
  if (payload.taskIdentifier && payload.taskTitle) {
    lines.push(`${payload.taskIdentifier} · ${payload.taskTitle}`)
  }
  if (payload.actorName) lines.push(`_by ${payload.actorName}_`)
  if (payload.prTitle) {
    lines.push(`PR: <${payload.prUrl}|#${payload.prNumber} ${payload.prTitle}>`)
  }
  if (payload.commentBody) {
    lines.push(`> ${payload.commentBody.slice(0, 120)}`)
  }

  const blocks: object[] = [
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
  ]

  if (url) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open in Lumo ↗' },
          url,
        },
      ],
    })
  }

  return blocks
}

async function getIntegrationToken(
  workspaceId: string
): Promise<string | null> {
  const integration = await prisma.slackIntegration.findUnique({
    where: { workspaceId },
    select: { accessToken: true },
  })
  if (!integration) return null
  return decrypt(integration.accessToken)
}

async function postToChannel(
  token: string,
  channelId: string,
  blocks: object[]
): Promise<void> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: channelId, blocks }),
  })
  const data = await res.json().catch(() => ({}))
  if (!(data as { ok?: boolean }).ok) {
    console.error(
      '[slack] chat.postMessage error:',
      (data as { error?: string }).error ?? res.status
    )
  }
}

async function lookupSlackUserByClerkId(
  clerkId: string,
  token: string
): Promise<string | null> {
  try {
    const { createClerkClient } = await import('@clerk/nextjs/server')
    const secretKey = process.env.CLERK_SECRET_KEY
    if (!secretKey) return null
    const clerk = createClerkClient({
      secretKey,
    })
    const user = await clerk.users.getUser(clerkId)
    const email = user.emailAddresses.find(
      e => e.id === user.primaryEmailAddressId
    )?.emailAddress
    if (!email) return null

    const res = await fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const data = await res.json()
    if (!data.ok) return null
    return data.user?.id ?? null
  } catch {
    return null
  }
}

/**
 * Send a notification to all configured SlackChannel rows that have this
 * event enabled. Fire-and-forget safe — never throws.
 */
export async function sendChannelNotification(
  workspaceId: string,
  event: SlackEventType,
  payload: NotificationPayload,
  projectId: string // required — scope notifications to this project's configured channel
): Promise<void> {
  try {
    // Workspace scoping is maintained via the outer findUnique({ where: { workspaceId } }).
    // The channels filter is an additional constraint on the relation — not a standalone query.
    const integration = await prisma.slackIntegration.findUnique({
      where: { workspaceId },
      select: {
        accessToken: true,
        channels: {
          where: { projectId, events: { has: event } },
          select: { channelId: true },
        },
      },
    })
    if (!integration || integration.channels.length === 0) return

    const token = decrypt(integration.accessToken)
    const blocks = buildBlocks(event, payload)

    await Promise.allSettled(
      integration.channels.map(c => postToChannel(token, c.channelId, blocks))
    )
  } catch (error) {
    console.error(
      `[slack notify] sendChannelNotification error (${event}):`,
      error
    )
  }
}

/**
 * Send a DM to a Lumo workspace member identified by Clerk ID.
 * Resolves their Slack user via primary email. Gracefully no-ops if not found.
 * Fire-and-forget safe — never throws.
 */
export async function sendDMNotification(
  workspaceId: string,
  recipientClerkId: string,
  event: SlackEventType,
  payload: NotificationPayload
): Promise<void> {
  try {
    const token = await getIntegrationToken(workspaceId)
    if (!token) return

    const slackUserId = await lookupSlackUserByClerkId(recipientClerkId, token)
    if (!slackUserId) return

    // Open or retrieve the DM channel for this user
    const openRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ users: slackUserId }),
    })
    const openData = await openRes.json()
    if (!openData.ok) return

    const blocks = buildBlocks(event, payload)
    await postToChannel(token, openData.channel.id, blocks)
  } catch (error) {
    console.error(`[slack notify] sendDMNotification error (${event}):`, error)
  }
}
