import { prisma } from '@/lib/db/prisma'
import { notificationRepository } from '@/lib/repositories/notification.repository'
import type { NotificationType } from '@prisma/client'

/**
 * Dispatch SPRINT_STARTED or SPRINT_CLOSED notifications to all team members.
 * Fire-and-forget — call with .catch(err => void err) from the service.
 */
export async function dispatchSprintNotification(
  sprintId: string,
  teamId: string,
  workspaceId: string,
  type: Extract<NotificationType, 'SPRINT_STARTED' | 'SPRINT_CLOSED'>,
  triggerActorId: string | null
): Promise<void> {
  const members = await prisma.teamMember.findMany({
    where: { teamId },
    select: { member: { select: { actor: { select: { id: true } } } } },
  })

  const recipientActorIds = members
    .map(m => m.member.actor?.id)
    .filter((x): x is string => !!x)

  if (recipientActorIds.length === 0) return

  await notificationRepository.createMany(
    recipientActorIds.map(actorId => ({
      workspaceId,
      recipientActorId: actorId,
      type,
      sprintId,
      triggerActorId,
    }))
  )
}
