import { prisma } from '@/lib/db/prisma'
import { notifyWorkspaceOwners } from '@/lib/services/notification.service'
import type { AgentStatusChangedEvent } from '../types'

/**
 * When agent transitions to INPUT_REQUIRED with reason 'spec_review',
 * notify all workspace owners that a spec is ready.
 */
export async function handleNotifySpecReady(
  event: AgentStatusChangedEvent
): Promise<void> {
  if (event.to !== 'INPUT_REQUIRED') return

  // Only notify for spec_review, not clarify or other input reasons
  const taskForReason = await prisma.task.findUnique({
    where: { id: event.taskId },
    select: { inputReason: true },
  })
  if (taskForReason?.inputReason !== 'spec_review') return

  const task = await prisma.task.findUnique({
    where: { id: event.taskId },
    select: {
      project: {
        select: { workspaceId: true },
      },
    },
  })
  if (!task) return

  await notifyWorkspaceOwners({
    workspaceId: task.project.workspaceId,
    taskId: event.taskId,
    type: 'TASK_SPEC_READY',
    triggerActorId: null,
  })
}
