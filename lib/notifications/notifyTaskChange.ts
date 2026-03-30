import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db/prisma'
import { sendChannelNotification, sendDMNotification } from '@/lib/slack/notify'
import { pushUserEvent } from '@/lib/pusher/server'
import type { SlackEventType, NotificationPayload } from '@/lib/slack/types'
import type { NotificationType } from '@prisma/client'
import { buildTaskUrl, buildTaskIdentifier } from '@/lib/utils/buildTaskUrl'

// ── Context shared by all notification helpers ──────────────────────────────

export interface TaskNotificationCtx {
  workspaceId: string
  taskTitle: string
  taskIdentifier: string // e.g. "LUM-42"
  taskUrl: string
  projectId: string
  triggerActorId: string | null
  triggerClerkId: string // current user — skip self-notifications
}

export function buildTaskNotificationCtx(
  task: {
    projectId: string
    number: number
    project: {
      workspaceId: string
      workspace?: { slug: string } | null
    }
  },
  updated: { title: string; team: { identifier: string } },
  triggerActorId: string | null,
  triggerClerkId: string
): TaskNotificationCtx {
  const workspaceSlug = task.project.workspace?.slug ?? ''
  const taskIdentifier = buildTaskIdentifier(
    updated.team.identifier,
    task.number
  )
  return {
    workspaceId: task.project.workspaceId,
    taskTitle: updated.title,
    taskIdentifier,
    taskUrl: buildTaskUrl(workspaceSlug, updated.team.identifier, task.number),
    projectId: task.projectId,
    triggerActorId,
    triggerClerkId,
  }
}

// ── Notify a single actor (inbox + Slack DM + real-time push) ───────────────

export async function notifyActor(params: {
  ctx: TaskNotificationCtx
  taskId: string
  recipientActorId: string
  notificationType: NotificationType
  slackEventType: SlackEventType
  commentId?: string
  skipSelfCheck?: boolean // e.g. TASK_DONE notifies assignee regardless
}): Promise<void> {
  const {
    ctx,
    taskId,
    recipientActorId,
    slackEventType,
    skipSelfCheck = false,
  } = params

  const actor = await prisma.actor.findUnique({
    where: { id: recipientActorId },
    select: { type: true, member: { select: { clerkId: true } } },
  })

  if (!actor || actor.type !== 'HUMAN' || !actor.member) return
  if (!skipSelfCheck && actor.member.clerkId === ctx.triggerClerkId) return

  const payload: NotificationPayload = {
    taskId,
    taskTitle: ctx.taskTitle,
    taskIdentifier: ctx.taskIdentifier,
    taskUrl: ctx.taskUrl,
  }

  // Inbox notification
  await prisma.notification.create({
    data: {
      workspaceId: ctx.workspaceId,
      recipientActorId,
      type: params.notificationType,
      taskId,
      commentId: params.commentId ?? null,
      triggerActorId: ctx.triggerActorId,
    },
  })

  // Real-time push
  waitUntil(pushUserEvent(actor.member.clerkId, { type: 'notification:new' }))

  // Slack DM
  waitUntil(
    sendDMNotification(
      ctx.workspaceId,
      actor.member.clerkId,
      slackEventType,
      payload
    )
  )
}

// ── Send Slack channel notification ─────────────────────────────────────────

export function notifyChannel(
  ctx: TaskNotificationCtx,
  taskId: string,
  slackEventType: SlackEventType
): void {
  waitUntil(
    sendChannelNotification(
      ctx.workspaceId,
      slackEventType,
      {
        taskId,
        taskTitle: ctx.taskTitle,
        taskIdentifier: ctx.taskIdentifier,
        taskUrl: ctx.taskUrl,
      },
      ctx.projectId
    )
  )
}

// ── Notify actor + channel in one call ──────────────────────────────────────

export function notifyStatusChange(params: {
  ctx: TaskNotificationCtx
  taskId: string
  recipientActorId: string | null
  notificationType: NotificationType
  slackEventType: SlackEventType
  skipSelfCheck?: boolean
}): void {
  const { ctx, taskId, recipientActorId, slackEventType } = params

  notifyChannel(ctx, taskId, slackEventType)

  if (recipientActorId) {
    waitUntil(
      notifyActor({
        ctx,
        taskId,
        recipientActorId,
        notificationType: params.notificationType,
        slackEventType,
        skipSelfCheck: params.skipSelfCheck ?? false,
      }).catch(err =>
        console.error(`[notify] ${params.notificationType} failed:`, err)
      )
    )
  }
}
