import { waitUntil } from '@/lib/runtime/wait-until'
import { prisma } from '@/lib/db/prisma'
import { ACTIVE_MEMBER } from '@/lib/members/deactivation'
import { pushUserEvent } from '@/lib/integrations/pusher'
import type { NotificationType } from '@prisma/client'
import { shouldNotifyBatch } from './preferenceGate'

/**
 * Send an inbox notification (and real-time push) to every workspace OWNER,
 * skipping the triggering actor if they are themselves an owner, and any
 * owner whose in-app preference turns this type off (one batched preference
 * read for all owners; ALWAYS_NOTIFY types are never silenced — LUM-1101).
 */
export async function notifyWorkspaceOwners(params: {
  workspaceId: string
  taskId: string
  type: NotificationType
  triggerActorId: string | null
  /** Mark the inbox item as awaiting a human action (AGENT_* escalations). */
  requiresAction?: boolean
}): Promise<void> {
  const { workspaceId, taskId, type, triggerActorId, requiresAction } = params

  const ownerActors = await prisma.actor.findMany({
    where: {
      workspaceId,
      type: 'HUMAN',
      member: { role: 'OWNER', ...ACTIVE_MEMBER },
    },
    select: { id: true, member: { select: { clerkId: true } } },
  })
  const candidates = ownerActors.filter(a => a.id !== triggerActorId)
  if (candidates.length === 0) return

  const allowed = await shouldNotifyBatch(
    candidates.map(a => a.id),
    'inApp',
    type
  )
  const recipients = candidates.filter(a => allowed.has(a.id))
  if (recipients.length === 0) return

  await prisma.notification.createMany({
    data: recipients.map(a => ({
      workspaceId,
      recipientActorId: a.id,
      type,
      taskId,
      triggerActorId,
      requiresAction: requiresAction ?? false,
    })),
  })

  for (const a of recipients) {
    if (a.member?.clerkId) {
      waitUntil(pushUserEvent(a.member.clerkId, { type: 'notification:new' }))
    }
  }
}
