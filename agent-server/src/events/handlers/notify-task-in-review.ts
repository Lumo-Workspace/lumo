import { prisma } from '../../db/prisma.js'
import { notifyTaskInReview } from '../../notifications/notifyTaskInReview.js'
import type { TaskStatusChangedEvent } from '@lumo/shared'

/**
 * When task transitions to IN_REVIEW, notify all workspace owners via inbox.
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
