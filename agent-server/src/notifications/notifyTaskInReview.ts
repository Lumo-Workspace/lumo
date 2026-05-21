import { notifyWorkspaceOwners } from './notifyWorkspaceOwners.js'

/**
 * Fires a TASK_IN_REVIEW notification to every workspace owner.
 * Slack notifications are omitted in agent-server (handled by Next.js app).
 */
export async function notifyTaskInReview(params: {
  workspaceId: string
  taskId: string
  triggerActorId: string | null
}): Promise<void> {
  const { workspaceId, taskId, triggerActorId } = params

  await notifyWorkspaceOwners({
    workspaceId,
    taskId,
    type: 'TASK_IN_REVIEW',
    triggerActorId,
  })
}
