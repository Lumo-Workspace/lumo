import { notifyReviewerOrOwners } from './notifyReviewerOrOwners.js'

/**
 * Fires a TASK_IN_REVIEW notification to the effective reviewer.
 * Slack notifications are omitted in agent-server (handled by Next.js app).
 */
export async function notifyTaskInReview(params: {
  workspaceId: string
  taskId: string
  reviewerActorId: string | null
  ownerActorId: string | null
  triggerActorId: string | null
}): Promise<void> {
  const {
    workspaceId,
    taskId,
    reviewerActorId,
    ownerActorId,
    triggerActorId,
  } = params
  const effectiveActorId = reviewerActorId ?? ownerActorId ?? null

  await notifyReviewerOrOwners({
    workspaceId,
    taskId,
    type: 'TASK_IN_REVIEW',
    reviewerActorId: effectiveActorId,
    ownerMemberId: null,
    triggerActorId,
  })
}
