// lib/services/comment.service.ts
import { commentRepository } from '@/lib/repositories/comment.repository'
import { memberRepository, notificationRepository } from '@/lib/repositories'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { shouldNotifyBatch } from '@/lib/services/notification.service'
import {
  sendDMNotification,
  sendChannelNotification,
} from '@/lib/integrations/slack'
import { pushTaskEvent, pushUserEvent } from '@/lib/integrations/pusher'
import { buildTaskUrl } from '@/lib/utils/buildTaskUrl'
import { dispatchEvents } from '@/lib/events/dispatcher'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'

interface CreateCommentInput {
  taskId: string
  authorActorId: string
  body: string
  parentId: string | null
  quotedCommentId: string | null
}

interface CreateCommentWithSideEffectsInput extends CreateCommentInput {
  authorClerkId: string
  workspaceId: string
  projectId: string
  taskTitle: string
  taskNumber: number
  taskId: string
  teamIdentifier: string
  workspaceSlug: string
  waitUntil: (promise: Promise<unknown>) => void
  mirrorOrigin?: 'inbound' | 'user'
}

interface NotifyMentionsParams {
  taskId: string
  commentId: string
  body: string
  authorActorId: string
  authorClerkId: string
  workspaceId: string
  projectId: string
  taskTitle: string
  taskNumber: number
  teamIdentifier: string
  workspaceSlug: string
  waitUntil: (promise: Promise<unknown>) => void
}

export const commentService = {
  /** Get all top-level comments with replies for a task. */
  async getComments(taskId: string) {
    return commentRepository.findByTaskId(taskId)
  },

  /** Create a comment or reply with validation. Throws on validation errors. */
  async createComment(input: CreateCommentInput) {
    if (input.parentId) {
      const parent = await commentRepository.findById(input.parentId)
      if (
        !parent ||
        parent.taskId !== input.taskId ||
        parent.deletedAt !== null
      ) {
        throw Object.assign(new Error('Parent comment not found'), {
          status: 404,
        })
      }
      if (parent.parentId !== null) {
        throw Object.assign(new Error('Cannot reply to a reply'), {
          status: 400,
        })
      }
    }
    return commentRepository.create(input)
  },

  /** Parse @mention clerkIds from comment body HTML. Excludes author and __agent__. */
  parseMentionedClerkIds(body: string, authorClerkId: string): string[] {
    const mentionRegex = /data-type="mention"[^>]*data-id="([^"]+)"/g
    const ids: string[] = []
    let match: RegExpExecArray | null
    while ((match = mentionRegex.exec(body)) !== null) {
      const clerkId = match[1]
      if (
        clerkId &&
        clerkId !== authorClerkId &&
        clerkId !== '__agent__' &&
        !ids.includes(clerkId)
      ) {
        ids.push(clerkId)
      }
    }
    return ids
  },

  /** Check if comment body contains an @agent mention. */
  hasAgentMention(body: string): boolean {
    return body.includes('data-id="__agent__"')
  },

  /**
   * Process @mention notifications for a comment.
   * Sends inbox, Slack DM, and channel notifications to mentioned users.
   */
  async notifyMentions(params: NotifyMentionsParams): Promise<void> {
    const {
      taskId,
      commentId,
      body,
      authorActorId,
      authorClerkId,
      workspaceId,
      projectId,
      taskTitle,
      taskNumber,
      teamIdentifier,
      workspaceSlug,
      waitUntil,
    } = params

    const mentionedIds = commentService.parseMentionedClerkIds(
      body,
      authorClerkId
    )
    if (mentionedIds.length === 0) return

    const members = await memberRepository.findByWorkspaceAndClerkIds(
      workspaceId,
      mentionedIds
    )
    if (members.length === 0) return

    const mentionPayload = {
      taskId,
      taskTitle,
      commentBody: body.replace(/<[^>]+>/g, '').slice(0, 200),
      taskUrl: buildTaskUrl(workspaceSlug, teamIdentifier, taskNumber),
    }

    const recipientActors = members
      .map(m => m.actor?.id)
      .filter((actorId): actorId is string => !!actorId)

    // Batch preference checks for inApp and slack channels
    const [inAppAllowed, slackAllowed] = await Promise.all([
      shouldNotifyBatch(recipientActors, 'inApp', 'TASK_MENTIONED'),
      shouldNotifyBatch(recipientActors, 'slack', 'TASK_MENTIONED'),
    ])

    // Slack DM — only to users who have slack mention enabled
    for (const m of members) {
      if (m.actor?.id && slackAllowed.has(m.actor.id)) {
        waitUntil(
          sendDMNotification(
            workspaceId,
            m.clerkId,
            'comment_mention',
            mentionPayload
          )
        )
      }
    }

    // Channel notification (project-level, not gated by personal preference)
    waitUntil(
      sendChannelNotification(
        workspaceId,
        'comment_mention',
        {
          ...mentionPayload,
          taskId,
          taskIdentifier: `${teamIdentifier}-${taskNumber}`,
        },
        projectId
      )
    )

    // Inbox notifications — only for users who have inApp mention enabled
    const inAppRecipients = recipientActors.filter(id => inAppAllowed.has(id))
    if (inAppRecipients.length === 0) return

    // Push real-time notification for inbox recipients
    for (const m of members) {
      if (m.clerkId && m.actor?.id && inAppAllowed.has(m.actor.id)) {
        waitUntil(pushUserEvent(m.clerkId, { type: 'notification:new' }))
      }
    }
    await notificationRepository.createMany(
      inAppRecipients.map(recipientActorId => ({
        workspaceId,
        recipientActorId,
        type: 'TASK_MENTIONED' as const,
        taskId,
        commentId,
        triggerActorId: authorActorId,
      }))
    )
  },

  /**
   * Create a comment and fire all side effects:
   * real-time push, activity event, agent mention handling, @mention notifications.
   */
  async createCommentWithSideEffects(input: CreateCommentWithSideEffectsInput) {
    const {
      authorClerkId,
      workspaceId,
      projectId,
      taskTitle,
      taskNumber,
      teamIdentifier,
      workspaceSlug,
      waitUntil,
      mirrorOrigin,
      ...createInput
    } = input

    const comment = await commentService.createComment(createInput)

    // Push real-time comment event to task viewers
    waitUntil(
      pushTaskEvent(createInput.taskId, {
        type: 'comment:created',
        commentId: comment.id,
      })
    )

    // Fire-and-forget activity recording
    waitUntil(
      dispatchEvents([
        {
          type: 'task:comment_added',
          taskId: createInput.taskId,
          projectId,
          actorId: createInput.authorActorId,
          commentId: comment.id,
        } satisfies TaskActivityEvent,
      ])
    )

    // Handle @agent mention — delegate to orchestrator
    if (commentService.hasAgentMention(createInput.body)) {
      const { handleAgentComment } = await import('@/lib/agent/comment-handler')
      waitUntil(
        handleAgentComment({
          taskId: createInput.taskId,
          commentId: comment.id,
          commentBody: createInput.body,
          actorClerkId: authorClerkId,
        }).catch(err =>
          console.error('[comment/@agent] handleAgentComment failed:', err)
        )
      )
    }

    // Fire-and-forget: TASK_MENTIONED notifications for @mention chips
    commentService
      .notifyMentions({
        taskId: createInput.taskId,
        commentId: comment.id,
        body: createInput.body,
        authorActorId: createInput.authorActorId,
        authorClerkId,
        workspaceId,
        projectId,
        taskTitle,
        taskNumber,
        teamIdentifier,
        workspaceSlug,
        waitUntil,
      })
      .catch(err => console.error('[notify] TASK_MENTIONED failed:', err))

    if (mirrorOrigin !== 'inbound') {
      await prCommentMirrorService.scheduleOutbound(comment.id, 'CREATE', {
        mirrorOrigin: mirrorOrigin ?? 'user',
      })
    }

    return comment
  },

  async updateCommentWithSideEffects(input: {
    commentId: string
    body: string
    waitUntil: (p: Promise<unknown>) => void
    mirrorOrigin?: 'inbound' | 'user'
  }) {
    const updated = await commentRepository.update(input.commentId, {
      body: input.body,
    })
    await prCommentMirrorService.scheduleOutbound(input.commentId, 'UPDATE', {
      mirrorOrigin: input.mirrorOrigin ?? 'user',
    })
    return updated
  },

  async deleteCommentWithSideEffects(input: {
    commentId: string
    waitUntil: (p: Promise<unknown>) => void
    mirrorOrigin?: 'inbound' | 'user'
  }) {
    await commentRepository.delete(input.commentId)
    await prCommentMirrorService.scheduleOutbound(input.commentId, 'DELETE', {
      mirrorOrigin: input.mirrorOrigin ?? 'user',
    })
  },

  /**
   * Notify @mentions inside a mirrored (inbound) comment.
   * Uses findForComment — its TASK_COMMENT_SELECT shape returns exactly the
   * fields notifyMentions needs (team.identifier + project.workspace.slug).
   */
  async notifyMentionsForMirror(params: {
    commentId: string
    taskId: string
    body: string
    authorActorId: string
    workspaceId: string
  }): Promise<void> {
    const { taskRepository } = await import('@/lib/repositories')
    const task = await taskRepository.findForComment(params.taskId)
    if (!task) return
    return commentService.notifyMentions({
      taskId: params.taskId,
      commentId: params.commentId,
      body: params.body,
      authorActorId: params.authorActorId,
      authorClerkId: '', // pseudo-author has no clerkId; parseMentionedClerkIds still finds @mentions in body
      workspaceId: params.workspaceId,
      projectId: task.projectId ?? '',
      taskTitle: task.title,
      taskNumber: task.number,
      teamIdentifier: task.team?.identifier ?? '',
      workspaceSlug: task.project?.workspace?.slug ?? '',
      waitUntil: p => {
        void p
      },
    })
  },
}
