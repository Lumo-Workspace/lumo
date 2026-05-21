import { prisma } from '../../db/prisma.js'
import { notifyWorkspaceOwners } from '../../notifications/notifyWorkspaceOwners.js'
import type { AgentStatusChangedEvent } from '@lumo/shared'

/**
 * When agent transitions to INPUT_REQUIRED with reason 'spec_review',
 * notify every workspace owner that a spec is ready.
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
