import { prisma } from '@/lib/db/prisma'
import { notifyTaskInReview } from '@/lib/services/notification.service'
import type { TaskStatusChangedEvent } from '../types'

/**
 * When task transitions to IN_REVIEW, notify all workspace owners
 * via inbox + Slack (channel + project-owner DM).
 */
export async function handleNotifyTaskInReview(
  event: TaskStatusChangedEvent
): Promise<void> {
  if (event.to !== 'IN_REVIEW') return

  const task = await prisma.task.findUnique({
    where: { id: event.taskId },
    select: {
      project: {
        select: { workspaceId: true },
      },
    },
  })
  if (!task) return

  await notifyTaskInReview({
    workspaceId: task.project.workspaceId,
    taskId: event.taskId,
    triggerActorId: null,
  })
}
