import { prisma } from '../db/prisma.js'
import type { NotificationType } from '@prisma/client'

type Channel = 'inApp' | 'slack'

const INAPP_MAP: Partial<Record<NotificationType, string>> = {
  TASK_ASSIGNED: 'notifyInAppAssigned',
  TASK_SENT_BACK: 'notifyInAppAssigned',
  TASK_DONE: 'notifyInAppAssigned',
  TASK_IN_REVIEW: 'notifyInAppAssigned',
  TASK_SPEC_READY: 'notifyInAppAssigned',
  TASK_MENTIONED: 'notifyInAppMention',
  AGENT_DONE: 'notifyInAppAgentDone',
  AGENT_FAILED: 'notifyInAppAgentDone',
  AGENT_VERIFY: 'notifyInAppAgentDone',
  AGENT_CLARIFY: 'notifyInAppAgentInput',
  AGENT_AUTHORIZE: 'notifyInAppAgentInput',
}

const SLACK_MAP: Partial<Record<NotificationType, string>> = {
  TASK_ASSIGNED: 'notifySlackAssigned',
  TASK_SENT_BACK: 'notifySlackAssigned',
  TASK_DONE: 'notifySlackAssigned',
  TASK_IN_REVIEW: 'notifySlackAssigned',
  TASK_SPEC_READY: 'notifySlackAssigned',
  TASK_MENTIONED: 'notifySlackMention',
  AGENT_DONE: 'notifySlackAgentDone',
  AGENT_FAILED: 'notifySlackAgentDone',
  AGENT_VERIFY: 'notifySlackAgentDone',
  AGENT_CLARIFY: 'notifySlackAgentInput',
  AGENT_AUTHORIZE: 'notifySlackAgentInput',
}

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

export async function shouldNotify(
  recipientActorId: string,
  channel: Channel,
  notificationType: NotificationType
): Promise<boolean> {
  if (ALWAYS_NOTIFY.has(notificationType)) return true

  const field = getPreferenceField(channel, notificationType)
  if (!field) return true

  const actor = await prisma.actor.findUnique({
    where: { id: recipientActorId },
    select: { member: { select: { id: true } } },
  })
  if (!actor?.member) return true

  const pref = await prisma.userPreference.findUnique({
    where: { memberId: actor.member.id },
    select: { [field]: true },
  })
  if (!pref) return true

  return (pref as Record<string, unknown>)[field] !== false
}
