import { prisma } from '@/lib/db/prisma'
import { sendChannelNotification, sendDMNotification } from '@/lib/slack/notify'

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

  // Slack: send channel + DM notification for task_in_review
  // (must run before inbox guards — channel notifications fire regardless of reviewer assignment)
  const taskForSlack = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      title: true,
      number: true,
      projectId: true,
      team: {
        select: {
          identifier: true,
          workspace: { select: { id: true, slug: true } },
        },
      },
    },
  })
  if (taskForSlack) {
    const identifier = `${taskForSlack.team.identifier}-${taskForSlack.number}`
    const wsId = taskForSlack.team.workspace.id
    const taskUrl = `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${taskForSlack.team.workspace.slug}/tasks/${identifier}`
    void sendChannelNotification(
      wsId,
      'task_in_review',
      {
        taskId,
        taskTitle: taskForSlack.title,
        taskIdentifier: identifier,
        taskUrl,
      },
      taskForSlack.projectId
    )
    const effectiveReviewerClerkId = effectiveReviewerId
      ? ((
          await prisma.workspaceMember.findUnique({
            where: { id: effectiveReviewerId },
            select: { clerkId: true },
          })
        )?.clerkId ?? null)
      : null
    if (effectiveReviewerClerkId) {
      void sendDMNotification(
        wsId,
        effectiveReviewerClerkId,
        'task_in_review',
        {
          taskId,
          taskTitle: taskForSlack.title,
          taskIdentifier: identifier,
          taskUrl,
        }
      )
    }
  }

  // Inbox: notify reviewer (or workspace owners if no reviewer assigned)
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
