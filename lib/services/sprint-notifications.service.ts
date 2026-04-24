import { notificationRepository } from '@/lib/repositories/notification.repository'
import { sprintNotificationsRepository } from '@/lib/repositories/sprint-notifications.repository'
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
  const recipientActorIds =
    await sprintNotificationsRepository.findTeamActorIds(teamId)

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
