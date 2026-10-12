import { prisma } from '@/lib/db/prisma'
import type { NotificationType } from '@prisma/client'

// ── NotificationType → UserPreference field mapping ─────────────────────────

type Channel = 'inApp' | 'slack'

const INAPP_MAP: Partial<Record<NotificationType, string>> = {
  TASK_ASSIGNED: 'notifyInAppAssigned',
  TASK_SENT_BACK: 'notifyInAppAssigned',
  TASK_DONE: 'notifyInAppAssigned',
  TASK_IN_REVIEW: 'notifyInAppAssigned',
  TASK_SPEC_READY: 'notifyInAppAssigned',
  TASK_MENTIONED: 'notifyInAppMention',
  DOCUMENT_COMMENT_MENTIONED: 'notifyInAppMention',
  PROJECT_MENTIONED: 'notifyInAppMention',
  MILESTONE_MENTIONED: 'notifyInAppMention',
  DOCUMENT_MENTIONED: 'notifyInAppMention',
  AGENT_DONE: 'notifyInAppAgentDone',
  AGENT_FAILED: 'notifyInAppAgentDone',
  AGENT_VERIFY: 'notifyInAppAgentDone',
  AGENT_CLARIFY: 'notifyInAppAgentInput',
  AGENT_AUTHORIZE: 'notifyInAppAgentInput',
}

// Only types that actually send a Slack DM are listed. TASK_SPEC_READY and
// AGENT_* have no Slack sender, so they have no route here and the
// notifySlackAgentDone / notifySlackAgentInput columns are not read (their
// switches are hidden in the settings UI). Add a route together with a sender.
const SLACK_MAP: Partial<Record<NotificationType, string>> = {
  TASK_ASSIGNED: 'notifySlackAssigned',
  TASK_SENT_BACK: 'notifySlackAssigned',
  TASK_DONE: 'notifySlackAssigned',
  TASK_IN_REVIEW: 'notifySlackAssigned',
  TASK_MENTIONED: 'notifySlackMention',
  DOCUMENT_COMMENT_MENTIONED: 'notifySlackMention',
  PROJECT_MENTIONED: 'notifySlackMention',
  MILESTONE_MENTIONED: 'notifySlackMention',
  DOCUMENT_MENTIONED: 'notifySlackMention',
}

export const MENTION_NOTIFICATION_TYPES = [
  'TASK_MENTIONED',
  'DOCUMENT_COMMENT_MENTIONED',
  'PROJECT_MENTIONED',
  'MILESTONE_MENTIONED',
  'DOCUMENT_MENTIONED',
] as const satisfies readonly NotificationType[]

// requiresAction types are never silenced
const ALWAYS_NOTIFY: Set<NotificationType> = new Set([
  'AGENT_CLARIFY',
  'AGENT_AUTHORIZE',
  'AGENT_VERIFY',
])

function getPreferenceField(
  channel: Channel,
  type: NotificationType
): string | null {
  const map = channel === 'inApp' ? INAPP_MAP : SLACK_MAP
  return map[type] ?? null
}

// ── Single-recipient check ──────────────────────────────────────────────────

/**
 * Check whether a notification should be delivered to a recipient on a given channel.
 * Returns true if:
 * - The notification type requires action (always delivered)
 * - No preference record exists (defaults are all true)
 * - The corresponding preference toggle is true
 */
export async function shouldNotify(
  recipientActorId: string,
  channel: Channel,
  notificationType: NotificationType
): Promise<boolean> {
  if (ALWAYS_NOTIFY.has(notificationType)) return true

  const field = getPreferenceField(channel, notificationType)
  if (!field) return true // unmapped type → deliver

  const actor = await prisma.actor.findUnique({
    where: { id: recipientActorId },
    select: { member: { select: { id: true } } },
  })
  if (!actor?.member) return true // non-human or missing → deliver

  const pref = await prisma.userPreference.findUnique({
    where: { memberId: actor.member.id },
    select: { [field]: true },
  })
  if (!pref) return true // no record → defaults (all true)

  return (pref as Record<string, unknown>)[field] !== false
}

// ── Batch check (for multi-recipient scenarios like mentions) ───────────────

/**
 * Returns the set of recipientActorIds that should receive the notification.
 * More efficient than calling shouldNotify() in a loop — single DB round-trip.
 */
export async function shouldNotifyBatch(
  recipientActorIds: string[],
  channel: Channel,
  notificationType: NotificationType
): Promise<Set<string>> {
  if (recipientActorIds.length === 0) return new Set()
  if (ALWAYS_NOTIFY.has(notificationType)) return new Set(recipientActorIds)

  const field = getPreferenceField(channel, notificationType)
  if (!field) return new Set(recipientActorIds)

  const actors = await prisma.actor.findMany({
    where: { id: { in: recipientActorIds } },
    select: { id: true, member: { select: { id: true } } },
  })

  const memberIdToActorId = new Map<string, string>()
  const result = new Set<string>()

  for (const actor of actors) {
    if (!actor.member) {
      result.add(actor.id) // non-human → deliver
      continue
    }
    memberIdToActorId.set(actor.member.id, actor.id)
  }

  // Include actorIds not found in DB (shouldn't happen, but safe fallback)
  const foundActorIds = new Set(actors.map(a => a.id))
  for (const id of recipientActorIds) {
    if (!foundActorIds.has(id)) result.add(id)
  }

  if (memberIdToActorId.size === 0) return result

  const prefs = await prisma.userPreference.findMany({
    where: { memberId: { in: [...memberIdToActorId.keys()] } },
    select: { memberId: true, [field]: true },
  })

  const prefByMemberId = new Map<string, Record<string, unknown>>()
  for (const p of prefs) {
    if (p.memberId) prefByMemberId.set(p.memberId, p as Record<string, unknown>)
  }

  for (const [memberId, actorId] of memberIdToActorId) {
    const pref = prefByMemberId.get(memberId)
    // No pref record → defaults (all true); pref exists → check field
    if (!pref || pref[field] !== false) {
      result.add(actorId)
    }
  }

  return result
}
