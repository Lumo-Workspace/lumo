import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import type { LineageFragmentType } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { taskService } from '@/lib/services/task.service'
import { taskContextService } from '@/lib/services/task-context.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import type { PreviousSessionRecovery } from '@/lib/services/task-context.service'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'
import {
  FAILURE_PROMPT_THRESHOLD,
  aggregateSessionFailures,
  type SessionFailureRow,
  type TopFailureGroup,
} from '@/lib/services/session-failure-aggregate'

interface BindSessionToTaskInput {
  identity: VerifyApiKeyResult
  sessionId: string
  taskIdentifier: string
  /** When the session is already bound to a *different* task, the bind is
   *  refused (returns `status: 'already-bound'`) unless force is set. The CLI
   *  flips this to true only after the user confirms the override prompt.
   *  Defaults to false. */
  force?: boolean | undefined
}

export type BindSessionToTaskResult =
  | {
      status: 'bound'
      taskId: string
      taskIdentifier: string
      taskTitle: string
      /** Number of HookEvent rows whose null taskId was just filled in by this call. Zero means the session had no untagged events (often the case on re-attach or first-time attach before any hook fires). */
      retaggedEventCount: number
      /** Rendered memory section markdown for the bound task. Empty string when the task has no associated memories. */
      memorySection: string
      /** Recovery card data from the previous session on this task, or null if there is no prior session. */
      previousSession: PreviousSessionRecovery | null
      /** Rendered blocker-warning markdown for the bound task (LUM-172). Empty string when there is nothing to warn about. */
      blockerWarningSection: string
    }
  | {
      status: 'already-bound'
      /** The task the session is currently bound to. Surfaced (instead of
       *  silently clobbering Session.taskId) so the CLI can prompt
       *  `已绑定 LUM-X，覆盖为 LUM-Y? [y/N]` before re-binding. */
      currentTaskIdentifier: string
      currentTaskTitle: string
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

export interface MemoryDraftRow {
  id: string
  scope: 'TASK' | 'PROJECT'
  category: 'TRAP' | 'DECISION' | 'CONVENTION' | 'PROCEDURAL'
  content: unknown
  createdByMemberId: string | null
}

export interface MemoryReviewDraft {
  taskIdentifier: string | null
  memories: MemoryDraftRow[]
  watermark: string | null
}

interface ApplyMemoryReviewInput {
  identity: VerifyApiKeyResult
  sessionId: string
  watermark: string
  deleteIds: string[]
  promoteIds: string[]
}

interface PostProgressCommentInput {
  identity: VerifyApiKeyResult
  sessionId: string
  body: string
  watermark: string
  waitUntil: (promise: Promise<unknown>) => void
}

export interface FragmentUsageCandidate {
  fragmentType: LineageFragmentType
  fragmentId: string
  label: string
  used: boolean | null
}

export interface FragmentUsageDraft {
  taskIdentifier: string | null
  candidates: FragmentUsageCandidate[]
  alreadyVoted: boolean
}

interface ApplyFragmentUsageInput {
  identity: VerifyApiKeyResult
  sessionId: string
  usedRefs: { fragmentType: LineageFragmentType; fragmentId: string }[]
}

const USAGE_LABEL_MAX = 60

/** One-line, length-capped snippet of a memory's content for a vote label. */
function labelSnippet(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > USAGE_LABEL_MAX
    ? `${oneLine.slice(0, USAGE_LABEL_MAX)}…`
    : oneLine
}

/** Tag attached to a task that's repeatedly failing (LUM-153). Plain tag, not
 *  a TaskStatus enum value — keeps the shared board untouched, no migration. */
const BLOCKED_TAG_NAME = 'blocked'

export interface FailureDraftResult {
  taskIdentifier: string | null
  taskTitle: string | null
  /** Dominant failure group, or null when the session had no failures. */
  topFailure: TopFailureGroup | null
  /** Whether the bound task already carries the `blocked` tag. */
  alreadyBlocked: boolean
  /** True only when there's a bound task, the dominant failure recurred
   *  ≥ FAILURE_PROMPT_THRESHOLD times, and the task isn't already blocked. */
  shouldPrompt: boolean
}

export const sessionService = {
  async bindSessionToTask({
    identity,
    sessionId,
    taskIdentifier,
    force,
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

    // Refuse a silent overwrite: if the session is already bound to a
    // *different* task and the caller hasn't confirmed (force), return the
    // current binding so the CLI can prompt before clobbering Session.taskId.
    // Member-scoped read — a session owned by another member reads back as
    // "no binding" here and is rejected by the ownedByOther guard below, so
    // this never leaks another member's binding. Re-attaching to the same
    // task is not a conflict (idempotent), so it falls through to the upsert.
    if (!force) {
      const current = await sessionRepository.findForMemberWithBinding(
        sessionId,
        memberId
      )
      if (current?.task && current.task.id !== task.id) {
        return {
          status: 'already-bound',
          currentTaskIdentifier: `${current.task.team.identifier}-${current.task.number}`,
          currentTaskTitle: current.task.title,
        }
      }
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

    const [memorySection, previousSession, blockerWarningSection] =
      await Promise.all([
        taskContextService.buildMemorySectionForTask(task.id),
        taskContextService.buildPreviousSessionRecoveryForTask(
          task.id,
          sessionId
        ),
        // Never throws — returns '' on failure, so attach can't be broken by
        // the dependency warning (LUM-172).
        taskDependencyService.buildBlockerWarningSectionForTask(
          task.id,
          task.identifier
        ),
      ])

    return {
      status: 'bound',
      taskId: task.id,
      taskIdentifier: task.identifier,
      taskTitle: task.title,
      retaggedEventCount: count,
      memorySection,
      previousSession,
      blockerWarningSection,
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
   * Assemble the memory-review draft for `lumo session wrap`: the Layer1
   * memories this session sedimented since the last review. The watermark
   * (newest createdAt, ISO) is carried back on apply so the server advances
   * `lastMemoryReviewAt` to exactly the rows this draft covered. Empty payload
   * when the session is missing/unowned.
   */
  async getSessionMemoryDraft({
    identity,
    sessionId,
  }: SessionScopedInput): Promise<MemoryReviewDraft> {
    const empty: MemoryReviewDraft = {
      taskIdentifier: null,
      memories: [],
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

    const rows = await memoryRepository.findBySourceSessionId(
      sessionId,
      ctx.lastMemoryReviewAt ?? undefined
    )
    const memories: MemoryDraftRow[] = rows.map(r => ({
      id: r.id,
      scope: r.scope,
      category: r.category,
      content: r.content,
      createdByMemberId: r.createdByMemberId,
    }))
    return {
      taskIdentifier: ctx.taskIdentifier,
      memories,
      watermark:
        rows.length > 0 ? rows[rows.length - 1]!.createdAt.toISOString() : null,
    }
  },

  /**
   * Apply a wrap memory review: delete and/or promote-to-PROJECT the chosen
   * memories, then advance `lastMemoryReviewAt`. Authz is session-scoped — ids
   * not sedimented by THIS session are silently dropped, so the endpoint can't
   * be used to touch arbitrary memories. The watermark advances after the batch
   * commits (or immediately on keep-all), so a failed batch leaves the rows
   * eligible for the next wrap.
   */
  async applyMemoryReview({
    identity,
    sessionId,
    watermark,
    deleteIds,
    promoteIds,
  }: ApplyMemoryReviewInput): Promise<{ deleted: number; promoted: number }> {
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

    // Session-scoped authz: only ids this session sedimented are eligible.
    const ownIds = new Set(
      (await memoryRepository.findBySourceSessionId(sessionId)).map(m => m.id)
    )
    const toDelete = deleteIds.filter(id => ownIds.has(id))
    const toPromote = promoteIds.filter(
      id => ownIds.has(id) && !toDelete.includes(id)
    )

    const plans: Array<(tx: Prisma.TransactionClient) => Promise<void>> = []
    for (const id of toDelete) {
      plans.push(async tx => {
        await memoryRepository.delete(id, tx)
      })
    }
    for (const id of toPromote) {
      plans.push(async tx => {
        await memoryRepository.update(id, { scope: 'PROJECT' }, tx)
      })
    }
    if (plans.length > 0) {
      await memoryRepository.applyPlansAtomically(plans)
    }

    await sessionRepository.setLastMemoryReviewAt(
      sessionId,
      new Date(watermark)
    )
    return { deleted: toDelete.length, promoted: toPromote.length }
  },

  /**
   * Assemble the fragment-usage draft for `lumo session wrap` (LUM-300): the
   * context fragments this session consumed (its lineage edges) so the agent can
   * vote which it actually used. MEMORY fragments get a content snippet label;
   * others a typed id slice. `alreadyVoted` is true once any edge carries a
   * usedAt. Empty payload when the session is missing/unowned.
   */
  async getFragmentUsageDraft({
    identity,
    sessionId,
  }: SessionScopedInput): Promise<FragmentUsageDraft> {
    const empty: FragmentUsageDraft = {
      taskIdentifier: null,
      candidates: [],
      alreadyVoted: false,
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

    const edges =
      await lineageEdgeRepository.findSessionFragmentEdges(sessionId)
    const memIds = edges
      .filter(e => e.fragmentType === 'MEMORY')
      .map(e => e.fragmentId)
    const contentById = await memoryRepository.findContentByIds(memIds)

    const candidates: FragmentUsageCandidate[] = edges.map(e => {
      const content = contentById.get(e.fragmentId)
      const label =
        e.fragmentType === 'MEMORY' && content
          ? `[MEMORY] "${labelSnippet(content)}"`
          : `[${e.fragmentType}] ${e.fragmentId.slice(0, 8)}`
      return {
        fragmentType: e.fragmentType,
        fragmentId: e.fragmentId,
        label,
        used: e.used,
      }
    })
    return {
      taskIdentifier: ctx.taskIdentifier,
      candidates,
      alreadyVoted: edges.some(e => e.usedAt !== null),
    }
  },

  /**
   * Apply an agent usage vote (LUM-300): stamp used=true/false on this session's
   * lineage edges. Session-scoped — a missing/unowned session is a no-op so the
   * endpoint can't touch other sessions' edges.
   */
  async applyFragmentUsage({
    identity,
    sessionId,
    usedRefs,
  }: ApplyFragmentUsageInput): Promise<{ used: number; unused: number }> {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) return { used: 0, unused: 0 }

    const ctx = await sessionRepository.findProgressContextForMember(
      sessionId,
      memberId
    )
    if (!ctx) return { used: 0, unused: 0 }

    return lineageEdgeRepository.applyUsageVote(sessionId, usedRefs)
  },

  /**
   * Assemble the blocked-tag draft for `lumo session wrap` (LUM-153): detect
   * whether the same kind of failure recurred ≥ FAILURE_PROMPT_THRESHOLD times
   * this session and the bound task isn't already flagged. This is a *prompt*
   * signal only — the section asks the user; nothing is mutated here. Returns
   * `shouldPrompt: false` (no error) when the session is missing/unowned, has
   * no bound task, stayed below threshold, or is already blocked.
   */
  async getSessionFailureDraft({
    identity,
    sessionId,
  }: SessionScopedInput): Promise<FailureDraftResult> {
    const empty: FailureDraftResult = {
      taskIdentifier: null,
      taskTitle: null,
      topFailure: null,
      alreadyBlocked: false,
      shouldPrompt: false,
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
    // No bound task → nothing to tag, so never prompt.
    if (!ctx.taskId) return empty

    const rows = (await hookEventRepository.findFailuresBySession(
      sessionId
    )) as SessionFailureRow[]
    const topFailure = aggregateSessionFailures(rows)

    const tags = await tagRepository.findByTask(ctx.taskId)
    const alreadyBlocked = tags.some(t => t.name === BLOCKED_TAG_NAME)

    const shouldPrompt =
      topFailure !== null &&
      topFailure.count >= FAILURE_PROMPT_THRESHOLD &&
      !alreadyBlocked

    return {
      taskIdentifier: ctx.taskIdentifier,
      taskTitle: ctx.taskTitle,
      topFailure,
      alreadyBlocked,
      shouldPrompt,
    }
  },

  /**
   * Attach the `blocked` tag to the session's bound task (LUM-153). Called only
   * after the wrap-panel prompt is confirmed — never automatically. Idempotent:
   * find-or-create the workspace tag, then attach with skipDuplicates, so a
   * second confirm is a no-op. 409 when the session has no bound task, 404 when
   * the session is missing / not owned by the caller.
   */
  async markBoundTaskBlocked({
    identity,
    sessionId,
  }: SessionScopedInput): Promise<{ taskIdentifier: string; tag: string }> {
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
    if (!ctx.taskId || !ctx.taskIdentifier) {
      throw Object.assign(
        new Error(
          'Session is not bound to a task. Run `lumo session attach <LUM-N>` first.'
        ),
        { status: 409 }
      )
    }

    const tags = await tagRepository.findOrCreateMany(identity.workspace.id, [
      BLOCKED_TAG_NAME,
    ])
    const blocked = tags.find(t => t.name === BLOCKED_TAG_NAME)
    if (!blocked) {
      throw Object.assign(new Error('Failed to resolve blocked tag'), {
        status: 500,
      })
    }
    await tagRepository.addTaskTags(ctx.taskId, [blocked.id])

    return { taskIdentifier: ctx.taskIdentifier, tag: BLOCKED_TAG_NAME }
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
    const { taskRepository } =
      await import('@/lib/repositories/task.repository')
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
      projectName: task.project.name,
      waitUntil,
    })

    await sessionRepository.setLastProgressCommentAt(
      sessionId,
      new Date(watermark)
    )

    return { commentId: comment.id }
  },
}
