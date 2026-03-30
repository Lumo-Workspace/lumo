import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db/prisma'
import { sendChannelNotification, sendDMNotification } from '@/lib/slack/notify'
import { pushUserEvent } from '@/lib/pusher/server'
import { buildTaskUrl, buildTaskIdentifier } from '@/lib/utils/buildTaskUrl'

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
      select: { member: { select: { clerkId: true } } },
    })
    effectiveReviewerClerkId = actor?.member?.clerkId ?? null
  }

  // Load task data for notification payloads
  const task = await prisma.task.findUnique({
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
  if (!task) return

  const taskIdentifier = buildTaskIdentifier(task.team.identifier, task.number)
  const taskUrl = buildTaskUrl(
    task.team.workspace.slug,
    task.team.identifier,
    task.number
  )
  const payload = { taskId, taskTitle: task.title, taskIdentifier, taskUrl }

  // Slack: channel + DM (fire regardless of reviewer assignment)
  waitUntil(
    sendChannelNotification(
      task.team.workspace.id,
      'task_in_review',
      payload,
      task.projectId
    )
  )
  if (effectiveReviewerClerkId) {
    waitUntil(
      sendDMNotification(
        task.team.workspace.id,
        effectiveReviewerClerkId,
        'task_in_review',
        payload
      )
    )
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
    if (effectiveReviewerClerkId) {
      waitUntil(
        pushUserEvent(effectiveReviewerClerkId, { type: 'notification:new' })
      )
    }
  } else {
    // Fall back to workspace owners
    const ownerActors = await prisma.actor.findMany({
      where: { workspaceId, type: 'HUMAN', member: { role: 'OWNER' } },
      select: { id: true, member: { select: { clerkId: true } } },
    })
    const recipients = ownerActors.filter(a => a.id !== triggerActorId)
    if (recipients.length === 0) return
    await prisma.notification.createMany({
      data: recipients.map(a => ({
        workspaceId,
        recipientActorId: a.id,
        type: 'TASK_IN_REVIEW' as const,
        taskId,
        triggerActorId,
      })),
    })
    // Push real-time to each owner
    for (const a of recipients) {
      if (a.member?.clerkId) {
        waitUntil(pushUserEvent(a.member.clerkId, { type: 'notification:new' }))
      }
    }
  }
}
