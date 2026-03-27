import { prisma } from '@/lib/db/prisma'

/**
 * Fires a TASK_IN_REVIEW notification to the effective reviewer.
 *
 * actorId is a Clerk userId (string) when triggered by a user action,
 * or null when triggered by GitHub webhook (no Clerk actor).
 */
export async function notifyTaskInReview(params: {
  workspaceId: string
  taskId: string
  reviewerId: string | null
  defaultReviewerId: string | null
  actorId: string | null
}): Promise<void> {
  const { workspaceId, taskId, reviewerId, defaultReviewerId, actorId } = params
  const effectiveReviewerId = reviewerId ?? defaultReviewerId ?? null

  if (effectiveReviewerId) {
    const reviewer = await prisma.workspaceMember.findUnique({
      where: { id: effectiveReviewerId },
      select: { clerkId: true },
    })
    if (!reviewer || reviewer.clerkId === actorId) return
    await prisma.notification.create({
      data: {
        workspaceId,
        recipientId: reviewer.clerkId,
        type: 'TASK_IN_REVIEW',
        taskId,
        actorId,
      },
    })
  } else {
    const owners = await prisma.workspaceMember.findMany({
      where: { workspaceId, role: 'OWNER' },
      select: { clerkId: true },
    })
    const recipients = owners.map(o => o.clerkId).filter(c => c !== actorId)
    if (recipients.length === 0) return
    await prisma.notification.createMany({
      data: recipients.map(recipientId => ({
        workspaceId,
        recipientId,
        type: 'TASK_IN_REVIEW' as const,
        taskId,
        actorId,
      })),
    })
  }
}
