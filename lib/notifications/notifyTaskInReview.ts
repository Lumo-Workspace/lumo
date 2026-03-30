import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db/prisma'
import { getActorClerkId } from '@/lib/actor'
import { sendChannelNotification, sendDMNotification } from '@/lib/slack/notify'
import { buildTaskUrl, buildTaskIdentifier } from '@/lib/utils/buildTaskUrl'
import { notifyReviewerOrOwners } from './notifyReviewerOrOwners'

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

  // Resolve effective reviewer actor → clerkId for Slack DM
  const effectiveReviewerClerkId = effectiveActorId
    ? await getActorClerkId(effectiveActorId)
    : null

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

  // Slack: channel + DM
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

  // Inbox: notify reviewer or fallback to workspace owners
  // effectiveActorId is already resolved (reviewer or default reviewer actor)
  await notifyReviewerOrOwners({
    workspaceId,
    taskId,
    type: 'TASK_IN_REVIEW',
    reviewerActorId: effectiveActorId,
    defaultReviewerMemberId: null,
    triggerActorId,
  })
}
