import { prisma } from '../../db/prisma.js'
import { getHumanActorId } from '../../auth/actor.js'
import { notifyTaskInReview } from '../../notifications/notifyTaskInReview.js'
import type { TaskStatusChangedEvent } from '@lumo/shared'

/**
 * When task transitions to IN_REVIEW, notify the reviewer
 * (or fallback to workspace owners) via inbox.
 */
export async function handleNotifyTaskInReview(
  event: TaskStatusChangedEvent
): Promise<void> {
  if (event.to !== 'IN_REVIEW') return

  const task = await prisma.task.findUnique({
    where: { id: event.taskId },
    select: {
      reviewerActorId: true,
      project: {
        select: { workspaceId: true, ownerId: true },
      },
    },
  })
  if (!task) return

  const ownerActorId = task.project.ownerId
    ? await getHumanActorId(task.project.ownerId)
    : null

  await notifyTaskInReview({
    workspaceId: task.project.workspaceId,
    taskId: event.taskId,
    reviewerActorId: task.reviewerActorId,
    ownerActorId,
    triggerActorId: null,
  })
}
