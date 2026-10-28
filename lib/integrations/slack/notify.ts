import { prisma } from '@/lib/db/prisma'
import { decrypt } from '@/lib/crypto'
import { getSlackIntegrationToken } from './token'
import { SlackMessage } from './blocks'
import { buildNotificationMessage } from './notification-message'
import { slackLocaleService } from '@/lib/services/slack-locale.service'
import type { SlackLocale } from './i18n'
import {
  SlackEventType,
  NotificationAudience,
  NotificationPayload,
} from './types'

/** Display name for a Clerk ID, or null when the directory cannot say. */
async function lookupDisplayName(clerkId: string): Promise<string | null> {
  try {
    const { getCachedUser } = await import('@/lib/auth/user-profiles')
    const { name } = await getCachedUser(clerkId)
    return name && name !== 'Unknown' ? name : null
  } catch {
    return null
  }
}

/** Most mentioned people looked up (and listed) for one channel post. */
export const MAX_MENTIONED_NAMES = 10

/**
 * Fill in display names the caller only knew by Clerk ID (the actor, and the
 * people a mention named). A failed lookup just leaves the name out.
 */
async function resolveNames(
  event: SlackEventType,
  payload: NotificationPayload,
  audience: NotificationAudience
): Promise<NotificationPayload> {
  const needActor = !payload.actorName?.trim() && !!payload.actorClerkId
  // Only channel mention posts list who was mentioned; a DM's recipient is
  // the one, and other events never show the list.
  const mentionedIds =
    event !== 'comment_mention' ||
    audience === 'dm' ||
    (payload.mentionedNames?.length ?? 0) > 0
      ? []
      : (payload.mentionedClerkIds ?? []).slice(0, MAX_MENTIONED_NAMES)
  if (!needActor && mentionedIds.length === 0) return payload

  const [actorName, mentionedNames] = await Promise.all([
    needActor ? lookupDisplayName(payload.actorClerkId!) : null,
    Promise.all(mentionedIds.map(lookupDisplayName)),
  ])
  const resolved: NotificationPayload = { ...payload }
  if (actorName) resolved.actorName = actorName
  const names = mentionedNames.filter((n): n is string => !!n)
  if (names.length > 0) resolved.mentionedNames = names
  return resolved
}

async function buildMessage(
  event: SlackEventType,
  payload: NotificationPayload,
  audience: NotificationAudience,
  locale: SlackLocale
): Promise<SlackMessage> {
  return buildNotificationMessage(
    event,
    await resolveNames(event, payload, audience),
    audience,
    locale
  )
}

async function getIntegrationToken(
  workspaceId: string
): Promise<string | null> {
  const result = await getSlackIntegrationToken(workspaceId)
  return result?.token ?? null
}

async function postToChannel(
  token: string,
  channelId: string,
  message: SlackMessage
): Promise<void> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: channelId, ...message }),
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
    const { createUserDirectory, isUserDirectoryConfigured } =
      await import('@/lib/auth/users')
    if (!isUserDirectoryConfigured()) return null
    const clerk = await createUserDirectory()
    const user = await clerk.getUser(clerkId)
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
 * event enabled, in the workspace's default language (LUM-1097).
 * Fire-and-forget safe — never throws.
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
    const locale = await slackLocaleService.forWorkspace(workspaceId)
    const message = await buildMessage(event, payload, 'channel', locale)

    await Promise.allSettled(
      integration.channels.map(c => postToChannel(token, c.channelId, message))
    )
  } catch (error) {
    console.error(
      `[slack notify] sendChannelNotification error (${event}):`,
      error
    )
  }
}

/**
 * Send a DM to a Lumo workspace member identified by Clerk ID, in their own
 * language — the workspace default when they have none (LUM-1097).
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

    const locale = await slackLocaleService.forRecipient(
      workspaceId,
      recipientClerkId
    )
    const message = await buildMessage(event, payload, 'dm', locale)
    await postToChannel(token, openData.channel.id, message)
  } catch (error) {
    console.error(`[slack notify] sendDMNotification error (${event}):`, error)
  }
}
