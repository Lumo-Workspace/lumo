import { parseMentionedUserClerkIds } from '@/lib/editor/parse-mentions'
import { memberRepository, notificationRepository } from '@/lib/repositories'
import { shouldNotifyBatch } from '@/lib/services/notification.service'
import { sendDMNotification } from '@/lib/integrations/slack'
import { pushUserEvent } from '@/lib/integrations/pusher'
import type { NotificationType } from '@prisma/client'
import type {
  SlackEventType,
  NotificationPayload,
} from '@/lib/integrations/slack/types'
import { htmlToQuote, mentionContext } from '@/lib/utils/htmlToPreview'

/** Entity reference columns set on the inbox Notification row. Exactly one of
 *  the *Id fields is typically populated per surface. */
export interface MentionNotificationRef {
  taskId?: string | null
  projectId?: string | null
  milestoneId?: string | null
  documentId?: string | null
  commentId?: string
  documentCommentId?: string | null
}

export interface NotifyMentionDeltaParams {
  /** Prior stored HTML; '' or null when content is brand-new (all mentions are new). */
  oldHtml: string | null
  /** Newly stored HTML. */
  newHtml: string | null
  authorClerkId: string
  authorActorId: string
  workspaceId: string
  notificationType: NotificationType
  ref: MentionNotificationRef
  slackEvent: SlackEventType
  /**
   * What the mention is in (entity kind/title/URL, `mentionSurface`). The
   * author (`actorClerkId`) and the quote are filled in here: a comment is
   * quoted whole, an entity body (`mentionSurface: 'content'`) is quoted
   * around each recipient's own mention.
   */
  slackPayload: Omit<NotificationPayload, 'quote' | 'actorClerkId'>
  waitUntil: (promise: Promise<unknown>) => void
}

/**
 * Notify users newly @-mentioned between `oldHtml` and `newHtml`.
 *
 * Delta = mentions(new) − mentions(old). Author and __agent__ are already
 * excluded by parseMentionedUserClerkIds. Sends Slack DM (slack-enabled
 * recipients) + inbox rows (inApp-enabled recipients) + realtime push.
 * Channel broadcast is intentionally NOT done here (comment-only concern).
 */
export async function notifyMentionDelta(
  params: NotifyMentionDeltaParams
): Promise<void> {
  const {
    oldHtml,
    newHtml,
    authorClerkId,
    authorActorId,
    workspaceId,
    notificationType,
    ref,
    slackEvent,
    slackPayload,
    waitUntil,
  } = params

  const newIds = parseMentionedUserClerkIds(newHtml ?? '', authorClerkId)
  if (newIds.length === 0) return
  const oldIds = new Set(
    parseMentionedUserClerkIds(oldHtml ?? '', authorClerkId)
  )
  const delta = newIds.filter(id => !oldIds.has(id))
  if (delta.length === 0) return

  const members = await memberRepository.findByWorkspaceAndClerkIds(
    workspaceId,
    delta
  )
  if (members.length === 0) return

  const recipientActors = members
    .map(m => m.actor?.id)
    .filter((id): id is string => !!id)

  const [inAppAllowed, slackAllowed] = await Promise.all([
    shouldNotifyBatch(recipientActors, 'inApp', notificationType),
    shouldNotifyBatch(recipientActors, 'slack', notificationType),
  ])

  // Slack DM to slack-enabled recipients
  const wholeQuote =
    slackPayload.mentionSurface === 'content' ? null : htmlToQuote(newHtml)
  for (const m of members) {
    if (m.actor?.id && slackAllowed.has(m.actor.id)) {
      const payload: NotificationPayload = {
        ...slackPayload,
        actorClerkId: authorClerkId,
        quote: wholeQuote ?? mentionContext(newHtml, m.clerkId),
      }
      waitUntil(
        sendDMNotification(workspaceId, m.clerkId, slackEvent, payload).catch(
          () => {}
        )
      )
    }
  }

  // Inbox rows + realtime push to inApp-enabled recipients
  const inAppRecipients = recipientActors.filter(id => inAppAllowed.has(id))
  if (inAppRecipients.length === 0) return

  for (const m of members) {
    if (m.clerkId && m.actor?.id && inAppAllowed.has(m.actor.id)) {
      waitUntil(
        pushUserEvent(m.clerkId, { type: 'notification:new' }).catch(() => {})
      )
    }
  }

  await notificationRepository.createMany(
    inAppRecipients.map(recipientActorId => ({
      workspaceId,
      recipientActorId,
      type: notificationType,
      triggerActorId: authorActorId,
      ...ref,
    }))
  )
}
