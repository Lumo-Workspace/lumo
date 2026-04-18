import { prisma } from '../db/prisma.js'
import { getHumanActorId, getActorClerkId } from '../auth/actor.js'
import { pushUserEvent } from '../pusher/server.js'
import type { NotificationType } from '@prisma/client'

/**
 * Send an inbox notification to the effective reviewer, falling back to
 * all workspace owners if no reviewer is assigned.
 */
export async function notifyReviewerOrOwners(params: {
  workspaceId: string
  taskId: string
  type: NotificationType
  reviewerActorId: string | null
  ownerMemberId: string | null
  triggerActorId: string | null
}): Promise<void> {
  const {
    workspaceId,
    taskId,
    type,
    reviewerActorId,
    ownerMemberId,
    triggerActorId,
  } = params

  let effectiveActorId = reviewerActorId
  if (!effectiveActorId && ownerMemberId) {
    effectiveActorId = await getHumanActorId(ownerMemberId)
  }

  if (effectiveActorId) {
    if (effectiveActorId === triggerActorId) return

    await prisma.notification.create({
      data: {
        workspaceId,
        recipientActorId: effectiveActorId,
        type,
        taskId,
        triggerActorId,
      },
    })

    const clerkId = await getActorClerkId(effectiveActorId)
    if (clerkId) {
      void pushUserEvent(clerkId, { type: 'notification:new' })
    }
  } else {
    const ownerActors = await prisma.actor.findMany({
      where: { workspaceId, type: 'HUMAN', member: { role: 'OWNER' } },
      select: { id: true, member: { select: { clerkId: true } } },
    })
    const recipients = ownerActors.filter(a => a.id !== triggerActorId)
    if (recipients.length === 0) return

    await prisma.notification.createMany({
      data: recipients.map(a => ({
        workspaceId,
        recipientActorId: a.id,
        type,
        taskId,
        triggerActorId,
      })),
    })

    for (const a of recipients) {
      if (a.member?.clerkId) {
        void pushUserEvent(a.member.clerkId, { type: 'notification:new' })
      }
    }
  }
}
