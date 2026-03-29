import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db/prisma'
import { sendChannelNotification, sendDMNotification } from '@/lib/slack/notify'

/**
 * Fires a TASK_IN_REVIEW notification to the effective reviewer.
 *
 * triggerActorId is an Actor.id when triggered by a user action,
 * or null when triggered by GitHub webhook (no actor).
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

  // Resolve effective reviewer actor → clerkId
  let effectiveReviewerClerkId: string | null = null
  if (effectiveActorId) {
    const actor = await prisma.actor.findUnique({
      where: { id: effectiveActorId },
      select: { member: { select: { id: true, clerkId: true } } },
    })
    effectiveReviewerClerkId = actor?.member?.clerkId ?? null
  }

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
    waitUntil(
      sendChannelNotification(
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
    )
    if (effectiveReviewerClerkId) {
      waitUntil(
        sendDMNotification(wsId, effectiveReviewerClerkId, 'task_in_review', {
          taskId,
          taskTitle: taskForSlack.title,
          taskIdentifier: identifier,
          taskUrl,
        })
      )
    }
  }

  // Inbox: notify reviewer (or workspace owners if no reviewer assigned)
  if (effectiveActorId) {
    if (effectiveActorId === triggerActorId) return
    await prisma.notification.create({
      data: {
        workspaceId,
        recipientActorId: effectiveActorId,
        type: 'TASK_IN_REVIEW',
        taskId,
        triggerActorId,
      },
    })
  } else {
    // Fall back to workspace owners
    const ownerActors = await prisma.actor.findMany({
      where: {
        workspaceId,
        type: 'HUMAN',
        member: { role: 'OWNER' },
      },
      select: { id: true },
    })
    const recipients = ownerActors
      .map(a => a.id)
      .filter(actorId => actorId !== triggerActorId)
    if (recipients.length === 0) return
    await prisma.notification.createMany({
      data: recipients.map(recipientActorId => ({
        workspaceId,
        recipientActorId,
        type: 'TASK_IN_REVIEW' as const,
        taskId,
        triggerActorId,
      })),
    })
  }
}
