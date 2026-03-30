import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db/prisma'
import { pushUserEvent } from '@/lib/pusher/server'
import type { NotificationType } from '@prisma/client'

/**
 * Send an inbox notification to the effective reviewer, falling back to
 * all workspace owners if no reviewer is assigned.
 *
 * Resolves reviewerActorId → defaultReviewerId (member → actor) internally.
 */
export async function notifyReviewerOrOwners(params: {
  workspaceId: string
  taskId: string
  type: NotificationType
  reviewerActorId: string | null
  defaultReviewerMemberId: string | null
  triggerActorId: string | null
}): Promise<void> {
  const {
    workspaceId,
    taskId,
    type,
    reviewerActorId,
    defaultReviewerMemberId,
    triggerActorId,
  } = params

  // Resolve effective reviewer Actor ID
  let effectiveActorId = reviewerActorId
  if (!effectiveActorId && defaultReviewerMemberId) {
    const actor = await prisma.actor.findUnique({
      where: { memberId: defaultReviewerMemberId },
      select: { id: true },
    })
    effectiveActorId = actor?.id ?? null
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

    // Push real-time notification
    const actor = await prisma.actor.findUnique({
      where: { id: effectiveActorId },
      select: { member: { select: { clerkId: true } } },
    })
    if (actor?.member?.clerkId) {
      waitUntil(
        pushUserEvent(actor.member.clerkId, { type: 'notification:new' })
      )
    }
  } else {
    // Fall back to workspace owners
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
        waitUntil(pushUserEvent(a.member.clerkId, { type: 'notification:new' }))
      }
    }
  }
}
