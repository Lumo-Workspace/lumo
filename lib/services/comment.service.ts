// lib/services/comment.service.ts
import { parseMentionedUserClerkIds } from '@/lib/editor/parse-mentions'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { scanContent } from '@/lib/services/content-signals'
import { sanitizeCommentHtml } from '@/lib/html/sanitize-comment-html'
import { memberRepository } from '@/lib/repositories'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { notifyMentionDelta } from '@/lib/services/mention-notify.service'
import { sendChannelNotification } from '@/lib/integrations/slack'
import { pushTaskEvent } from '@/lib/integrations/pusher'
import { buildTaskUrl, buildTaskIdentifier } from '@/lib/utils/buildTaskUrl'
import { dispatchEvents } from '@/lib/events/dispatcher'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'
import { taskRepository } from '@/lib/repositories'
import { contentSummaryService } from '@/lib/services/content-summary.service'
import { waitUntil } from '@/lib/runtime/wait-until'
import { dependencyDetectionService } from '@/lib/services/dependency-detection.service'
import { htmlToQuote } from '@/lib/utils/htmlToPreview'
import { githubCommentProvenance } from '@/lib/context/reviewer-trust'
import { withAuthorNames } from '@/lib/services/comment-author-names'

/** Threads with at most this many comments are rendered inline (full text),
 *  so they never need an LLM summary. Beyond it, we cache a short summary. */
const COMMENTS_SUMMARY_THRESHOLD = 3

/** Flatten comments into "author: body" lines for summarization. */
export function buildCommentsSummaryInput(
  comments: Array<{ authorActorId: string | null; body: string }>
): string {
  return comments
    .map(c => `${c.authorActorId ?? 'unknown'}: ${c.body}`)
    .join('\n')
}

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
  projectName: string
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
  projectName: string
  waitUntil: (promise: Promise<unknown>) => void
}

// LUM-1238: author-name resolution lives in comment-author-names so the
// timeline can share it without pulling in this service's integrations.
export { actorLabel } from '@/lib/services/comment-author-names'
export type { ActorLabelFields } from '@/lib/services/comment-author-names'

export const commentService = {
  /** Get all top-level comments with replies for a task. */
  async getComments(taskId: string) {
    return commentRepository.findByTaskId(taskId)
  },

  /**
   * LUM-1232 G2: the thread plus each author's display name (`authorName`:
   * member name, agent name or `@github-login`; null when unknown), so API
   * readers never have to show a raw actor id. Best effort — a failed lookup
   * leaves every `authorName` null.
   */
  async getCommentsWithAuthors(taskId: string, workspaceId: string) {
    const comments = await commentRepository.findByTaskId(taskId)
    return withAuthorNames(comments, workspaceId)
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
    // LUM-783: the body is member/agent-authored untrusted text.
    // LUM-921: so it is also untrusted HTML — store only the allowlisted subset.
    // Signals scan the raw input: they record what the author attempted
    // (e.g. a wrapper-escape tag), which sanitizing would erase.
    return commentRepository.create({
      ...input,
      body: sanitizeCommentHtml(input.body),
      contentSignals: scanContent(input.body),
    })
  },

  /** Parse @mention clerkIds from comment body HTML. Excludes author and __agent__. */
  parseMentionedClerkIds(body: string, authorClerkId: string): string[] {
    return parseMentionedUserClerkIds(body, authorClerkId)
  },

  /** Re-export for tests / callers. */
  buildCommentsSummaryInput,

  /**
   * Fire-and-forget: if the task's thread now exceeds the inline threshold,
   * recompute and cache its comments summary. Short threads (<= 3) are
   * rendered inline at retrieval time, so we never call the LLM for them.
   * Runs via waitUntil and swallows errors so it never affects the caller.
   */
  async scheduleCommentsSummary(taskId: string): Promise<void> {
    const comments = await commentRepository.listAllForTask(taskId)
    if (comments.length <= COMMENTS_SUMMARY_THRESHOLD) return
    // LUM-1003: an unverified GitHub user's comment is quoted separately in
    // agent context; feeding it to the recap would launder its asks into
    // neutral-sounding summary text.
    const recapInput = comments.filter(c => {
      const gh = githubCommentProvenance(c)
      return !gh || gh.reviewer.trusted
    })
    if (recapInput.length === 0) return
    waitUntil(
      contentSummaryService
        .summarize(buildCommentsSummaryInput(recapInput), 'comments')
        .then(s =>
          s ? taskRepository.updateCommentsSummary(taskId, s) : undefined
        )
        .catch(() => {})
    )
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
      projectName,
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
      entityKind: 'task' as const,
      entityId: taskId,
      entityTitle: taskTitle,
      entityIdentifier: buildTaskIdentifier(teamIdentifier, taskNumber),
      entityUrl: buildTaskUrl(
        workspaceSlug,
        projectName,
        teamIdentifier,
        taskNumber
      ),
      mentionSurface: 'comment' as const,
    }

    // Channel notification stays here (project-level, comment-only — not gated
    // by personal preference). Fire regardless of per-user delta. It names
    // who was mentioned as plain text — nobody is <@…>-pinged (LUM-1095).
    waitUntil(
      sendChannelNotification(
        workspaceId,
        'comment_mention',
        {
          ...mentionPayload,
          actorClerkId: authorClerkId,
          mentionedClerkIds: members.map(m => m.clerkId),
          quote: htmlToQuote(body),
        },
        projectId
      )
    )

    // DM + inbox + realtime via the shared core (comment create ⇒ oldHtml = '').
    await notifyMentionDelta({
      oldHtml: '',
      newHtml: body,
      authorClerkId,
      authorActorId,
      workspaceId,
      notificationType: 'TASK_MENTIONED',
      ref: { taskId, commentId },
      slackEvent: 'comment_mention',
      slackPayload: mentionPayload,
      waitUntil,
    })
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
      projectName,
      waitUntil,
      mirrorOrigin,
      ...rawInput
    } = input
    // Side effects below (mentions, dependency edges) read the stored body.
    const createInput = {
      ...rawInput,
      body: sanitizeCommentHtml(rawInput.body),
    }

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
        projectName,
        waitUntil,
      })
      .catch(err => console.error('[notify] TASK_MENTIONED failed:', err))

    // ── Fire-and-forget: task→task mention 候选依赖边(LUM-172) ────────────
    waitUntil(
      dependencyDetectionService
        .detectMentionEdges({
          taskId: createInput.taskId,
          workspaceId,
          html: createInput.body,
          surface: 'comment',
        })
        .catch(() => {})
    )

    if (mirrorOrigin !== 'inbound') {
      await prCommentMirrorService.scheduleOutbound(comment.id, 'CREATE', {
        mirrorOrigin: mirrorOrigin ?? 'user',
      })
    }

    // Tiered context: recompute the cached comments summary when the thread
    // grows past the inline threshold. Never blocks; swallows its own errors.
    commentService.scheduleCommentsSummary(createInput.taskId).catch(() => {})

    return comment
  },

  async updateCommentWithSideEffects(input: {
    commentId: string
    body: string
    waitUntil: (p: Promise<unknown>) => void
    mirrorOrigin?: 'inbound' | 'user'
  }) {
    const updated = await commentRepository.update(input.commentId, {
      body: sanitizeCommentHtml(input.body),
      contentSignals: scanContent(input.body),
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
      projectName: task.project?.name ?? '',
      waitUntil: p => {
        void p
      },
    })
  },
}
