import { prisma } from '../../db/prisma.js'
import { notifyReviewerOrOwners } from '../../notifications/notifyReviewerOrOwners.js'
import type { AgentStatusChangedEvent } from '@lumo/shared'

/**
 * When agent transitions to INPUT_REQUIRED with reason 'spec_review',
 * notify the reviewer (or fallback to workspace owners) that a spec is ready.
 */
export async function handleNotifySpecReady(
  event: AgentStatusChangedEvent
): Promise<void> {
  if (event.to !== 'INPUT_REQUIRED') return

  const taskForReason = await prisma.task.findUnique({
    where: { id: event.taskId },
    select: { inputReason: true },
  })
  if (taskForReason?.inputReason !== 'spec_review') return

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
