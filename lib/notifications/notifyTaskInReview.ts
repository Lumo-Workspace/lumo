import { waitUntil } from '@/lib/runtime/wait-until'
import { prisma } from '@/lib/db/prisma'
import { getHumanActorId, getActorClerkId } from '@/lib/actor'
import {
  sendChannelNotification,
  sendDMNotification,
} from '@/lib/integrations/slack'
import { buildTaskUrl, buildTaskIdentifier } from '@/lib/utils/buildTaskUrl'
import { notifyWorkspaceOwners } from './notifyWorkspaceOwners'

/**
 * Fires a TASK_IN_REVIEW notification:
 * - Slack channel announcement
 * - Slack DM to the project owner (when resolvable)
 * - Inbox notification to every workspace OWNER
 *
 * triggerActorId is an Actor.id when triggered by a user action,
 * or null when triggered by GitHub webhook (no actor).
 */
export async function notifyTaskInReview(params: {
  workspaceId: string
  taskId: string
  triggerActorId: string | null
}): Promise<void> {
  const { workspaceId, taskId, triggerActorId } = params

  // Load task data for notification payloads + project owner resolution
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      title: true,
      number: true,
      projectId: true,
      project: { select: { name: true, ownerId: true } },
      team: {
        select: {
          identifier: true,
          workspace: { select: { id: true, slug: true } },
        },
      },
    },
  })
  if (!task) return

  // Resolve project owner → actor → Clerk ID for Slack DM target
  const ownerActorId = task.project.ownerId
    ? await getHumanActorId(task.project.ownerId)
    : null
  const ownerClerkId = ownerActorId ? await getActorClerkId(ownerActorId) : null

  const taskIdentifier = buildTaskIdentifier(task.team.identifier, task.number)
  const taskUrl = buildTaskUrl(
    task.team.workspace.slug,
    task.project.name,
    task.team.identifier,
    task.number
  )
  const payload = { taskId, taskTitle: task.title, taskIdentifier, taskUrl }

  // Slack: channel + DM (DM only if project owner resolvable)
  waitUntil(
    sendChannelNotification(
      task.team.workspace.id,
      'task_in_review',
      payload,
      task.projectId
    )
  )
  if (ownerClerkId) {
    waitUntil(
      sendDMNotification(
        task.team.workspace.id,
        ownerClerkId,
        'task_in_review',
        payload
      )
    )
  }

  // Inbox: notify all workspace owners
  await notifyWorkspaceOwners({
    workspaceId,
    taskId,
    type: 'TASK_IN_REVIEW',
    triggerActorId,
  })
}
