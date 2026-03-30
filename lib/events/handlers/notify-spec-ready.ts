import { prisma } from '@/lib/db/prisma'
import { notifyReviewerOrOwners } from '@/lib/notifications/notifyReviewerOrOwners'
import type { AgentStatusChangedEvent } from '../types'

/**
 * When agent transitions to SPEC_REVIEW, notify the reviewer
 * (or fallback to workspace owners) that a spec is ready.
 */
export async function handleNotifySpecReady(
  event: AgentStatusChangedEvent
): Promise<void> {
  if (event.to !== 'SPEC_REVIEW') return

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

  await notifyReviewerOrOwners({
    workspaceId: task.project.workspaceId,
    taskId: event.taskId,
    type: 'TASK_SPEC_READY',
    reviewerActorId: task.reviewerActorId,
    defaultReviewerMemberId: task.project.defaultReviewerId,
    triggerActorId: null,
  })
}
