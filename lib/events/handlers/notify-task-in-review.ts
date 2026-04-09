import { prisma } from '@/lib/db/prisma'
import { getHumanActorId } from '@/lib/actor'
import { notifyTaskInReview } from '@/lib/services/notification.service'
import type { TaskStatusChangedEvent } from '../types'

/**
 * When task transitions to IN_REVIEW, notify the reviewer
 * (or fallback to workspace owners) via inbox + Slack.
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
        select: { workspaceId: true, defaultReviewerId: true },
      },
    },
  })
  if (!task) return

  const defaultReviewerActorId = task.project.defaultReviewerId
    ? await getHumanActorId(task.project.defaultReviewerId)
    : null

  await notifyTaskInReview({
    workspaceId: task.project.workspaceId,
    taskId: event.taskId,
    reviewerActorId: task.reviewerActorId,
    defaultReviewerActorId,
    triggerActorId: null,
  })
}
