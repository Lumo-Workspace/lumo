import { prisma } from '@/lib/db/prisma'
import { notifyTaskInReview } from '@/lib/notifications/notifyTaskInReview'
import type { DomainEvent } from '../types'

/**
 * When task transitions to IN_REVIEW, notify the reviewer
 * (or fallback to workspace owners) via inbox + Slack.
 */
export async function handleNotifyTaskInReview(
  event: DomainEvent
): Promise<void> {
  if (event.type !== 'task:status_changed' || event.to !== 'IN_REVIEW') return

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

  // Resolve project.defaultReviewerId (WorkspaceMember.id) → Actor ID
  let defaultReviewerActorId: string | null = null
  if (task.project.defaultReviewerId) {
    const actor = await prisma.actor.findUnique({
      where: { memberId: task.project.defaultReviewerId },
      select: { id: true },
    })
    defaultReviewerActorId = actor?.id ?? null
  }

  await notifyTaskInReview({
    workspaceId: task.project.workspaceId,
    taskId: event.taskId,
    reviewerActorId: task.reviewerActorId,
    defaultReviewerActorId,
    triggerActorId: null,
  })
}
