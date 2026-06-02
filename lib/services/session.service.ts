import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskService } from '@/lib/services/task.service'
import { taskContextService } from '@/lib/services/task-context.service'
import type { PreviousSessionRecovery } from '@/lib/services/task-context.service'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'

interface BindSessionToTaskInput {
  identity: VerifyApiKeyResult
  sessionId: string
  taskIdentifier: string
}

interface BindSessionToTaskResult {
  taskId: string
  taskIdentifier: string
  taskTitle: string
  /** Number of HookEvent rows whose null taskId was just filled in by this call. Zero means the session had no untagged events (often the case on re-attach or first-time attach before any hook fires). */
  retaggedEventCount: number
  /** Rendered memory section markdown for the bound task. Empty string when the task has no associated memories. */
  memorySection: string
  /** Recovery card data from the previous session on this task, or null if there is no prior session. */
  previousSession: PreviousSessionRecovery | null
}

interface SessionScopedInput {
  identity: VerifyApiKeyResult
  sessionId: string
}

export type SessionStatusResult =
  | { exists: false }
  | {
      exists: true
      sessionId: string
      startedAt: Date
      lastActivityAt: Date
      eventCount: number
      taskIdentifier: string | null
      taskTitle: string | null
    }

export type UnbindSessionResult =
  | { found: false }
  | { found: true; alreadyUnbound: true }
  | {
      found: true
      alreadyUnbound: false
      previousTaskIdentifier: string
      previousTaskTitle: string
    }

export interface ProgressDraftResult {
  taskIdentifier: string | null
  taskTitle: string | null
  summaries: { id: string; turnSummary: string; createdAt: string }[]
  watermark: string | null
}

interface PostProgressCommentInput {
  identity: VerifyApiKeyResult
  sessionId: string
  body: string
  watermark: string
  waitUntil: (promise: Promise<unknown>) => void
}

export const sessionService = {
  async bindSessionToTask({
    identity,
    sessionId,
    taskIdentifier,
  }: BindSessionToTaskInput): Promise<BindSessionToTaskResult> {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) {
      throw Object.assign(new Error('Not a workspace member'), { status: 403 })
    }

    const task = await taskService.resolveIdentifier(
      identity.workspace.id,
      taskIdentifier
    )
    if (!task) {
      throw Object.assign(
        new Error(`Task ${taskIdentifier} not found in workspace`),
        { status: 404 }
      )
    }

    // Upsert the session row so attach can run before any hook fires.
    // If the row exists and belongs to a different member, refuse — the
    // session_id space is per-user and cross-member writes would be a hijack.
    const upserted = await sessionRepository.upsertWithTaskId({
      id: sessionId,
      workspaceId: identity.workspace.id,
      workspaceMemberId: memberId,
      taskId: task.id,
      now: new Date(),
    })
    if (upserted.ownedByOther) {
      throw Object.assign(new Error('Session belongs to another member'), {
        status: 403,
      })
    }

    const { count } =
      await hookEventRepository.bulkSetTaskIdForNullEventsInSession(
        sessionId,
        task.id
      )

    const [memorySection, previousSession] = await Promise.all([
      taskContextService.buildMemorySectionForTask(task.id),
      taskContextService.buildPreviousSessionRecoveryForTask(
        task.id,
        sessionId
      ),
    ])

    return {
      taskId: task.id,
      taskIdentifier: task.identifier,
      taskTitle: task.title,
      retaggedEventCount: count,
      memorySection,
      previousSession,
    }
  },

  /**
   * Look up the current binding state for a session owned by the bearer's
   * member. Returns `{ exists: false }` for sessions that don't exist or
   * belong to another member — both 404s from the caller's perspective,
   * with no leak about which case it is.
   */
  async getSessionStatus({
    identity,
    sessionId,
  }: SessionScopedInput): Promise<SessionStatusResult> {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) return { exists: false }

    const row = await sessionRepository.findForMemberWithBinding(
      sessionId,
      memberId
    )
    if (!row) return { exists: false }

    const task = row.task
    return {
      exists: true,
      sessionId: row.id,
      startedAt: row.startedAt,
      lastActivityAt: row.lastActivityAt,
      eventCount: row.eventCount,
      taskIdentifier: task ? `${task.team.identifier}-${task.number}` : null,
      taskTitle: task ? task.title : null,
    }
  },

  /**
   * Clear the task binding on a session owned by the bearer's member.
   * Idempotent: re-detaching an already-unbound session returns
   * `alreadyUnbound: true` instead of an error.
   *
   * Untagged hook events on the session are left untouched — they remain
   * associated with the prior task for historical accuracy. Only future
   * events on this session will be unbound.
   */
  async unbindSession({
    identity,
    sessionId,
  }: SessionScopedInput): Promise<UnbindSessionResult> {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) return { found: false }

    const result = await sessionRepository.clearTaskIdForMember(
      sessionId,
      memberId
    )
    if (!result) return { found: false }
    if (result.alreadyUnbound) return { found: true, alreadyUnbound: true }
    return {
      found: true,
      alreadyUnbound: false,
      previousTaskIdentifier: result.previous.taskIdentifier,
      previousTaskTitle: result.previous.taskTitle,
    }
  },

  /**
   * Assemble the unposted progress draft for `lumo session wrap`: the bound
   * task plus every turnSummary written since the last progress comment. The
   * watermark (newest summary's createdAt, ISO) is carried back by the CLI on
   * post so the server can advance `lastProgressCommentAt` to exactly the turns
   * this draft covered. Empty payload when the session is missing/unowned.
   */
  async getSessionProgressDraft({
    identity,
    sessionId,
  }: SessionScopedInput): Promise<ProgressDraftResult> {
    const empty: ProgressDraftResult = {
      taskIdentifier: null,
      taskTitle: null,
      summaries: [],
      watermark: null,
    }
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) return empty

    const ctx = await sessionRepository.findProgressContextForMember(
      sessionId,
      memberId
    )
    if (!ctx) return empty

    const rows = await hookEventRepository.findTurnSummariesBySession(
      sessionId,
      ctx.lastProgressCommentAt ?? undefined
    )
    const summaries = rows.map(r => ({
      id: r.id,
      turnSummary: r.turnSummary as string,
      createdAt: r.createdAt.toISOString(),
    }))
    return {
      taskIdentifier: ctx.taskIdentifier,
      taskTitle: ctx.taskTitle,
      summaries,
      watermark:
        summaries.length > 0
          ? summaries[summaries.length - 1]!.createdAt
          : null,
    }
  },

  /**
   * Post a wrap progress comment to the session's bound task, then advance the
   * watermark to `watermark` (the newest turn the draft covered). Reuses the
   * same comment context the POST /api/tasks/[id]/comments route assembles.
   * Watermark advances ONLY after the comment create succeeds, so a failed
   * post leaves the turns eligible for the next wrap (no silent data loss).
   */
  async postProgressComment({
    identity,
    sessionId,
    body,
    watermark,
    waitUntil,
  }: PostProgressCommentInput): Promise<{ commentId: string }> {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) {
      throw Object.assign(new Error('Session not found'), { status: 404 })
    }

    const ctx = await sessionRepository.findProgressContextForMember(
      sessionId,
      memberId
    )
    if (!ctx) {
      throw Object.assign(new Error('Session not found'), { status: 404 })
    }
    if (!ctx.taskId) {
      throw Object.assign(
        new Error(
          'Session is not bound to a task. Run `lumo session attach <LUM-N>` first.'
        ),
        { status: 409 }
      )
    }

    // Lazy imports: keep comment.service's heavy transitive deps (pusher, agent
    // delegation, PR mirroring) off this module's load path so importing
    // session.service in tests / other call sites doesn't pull an ESM chain
    // jest can't parse. Matches the lazy-import pattern in comment.service.ts.
    const { taskRepository } = await import('@/lib/repositories/task.repository')
    const { commentService } = await import('@/lib/services/comment.service')
    const { getHumanActorId } = await import('@/lib/actor')

    const task = await taskRepository.findForComment(ctx.taskId)
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }

    const authorActorId = await getHumanActorId(memberId)
    if (!authorActorId) {
      throw Object.assign(new Error('Actor not found'), { status: 500 })
    }

    const comment = await commentService.createCommentWithSideEffects({
      taskId: ctx.taskId,
      authorActorId,
      body,
      parentId: null,
      quotedCommentId: null,
      authorClerkId: identity.user.id,
      workspaceId: task.project.workspaceId,
      projectId: task.projectId,
      taskTitle: task.title,
      taskNumber: task.number,
      teamIdentifier: task.team?.identifier ?? '',
      workspaceSlug: task.project.workspace?.slug ?? '',
      waitUntil,
    })

    await sessionRepository.setLastProgressCommentAt(
      sessionId,
      new Date(watermark)
    )

    return { commentId: comment.id }
  },
}
