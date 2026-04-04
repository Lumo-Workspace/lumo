import { notifyReviewerOrOwners } from './notifyReviewerOrOwners.js'

/**
 * Fires a TASK_IN_REVIEW notification to the effective reviewer.
 * Slack notifications are omitted in agent-server (handled by Next.js app).
 */
export async function notifyTaskInReview(params: {
  workspaceId: string
  taskId: string
  reviewerActorId: string | null
  defaultReviewerActorId: string | null
  triggerActorId: string | null
}): Promise<void> {
  const {
    workspaceId,
    taskId,
    reviewerActorId,
    defaultReviewerActorId,
    triggerActorId,
  } = params
  const effectiveActorId = reviewerActorId ?? defaultReviewerActorId ?? null

  await notifyReviewerOrOwners({
    workspaceId,
    taskId,
    type: 'TASK_IN_REVIEW',
    reviewerActorId: effectiveActorId,
    defaultReviewerMemberId: null,
    triggerActorId,
  })
}
