import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskService } from '@/lib/services/task.service'
import { taskContextService } from '@/lib/services/task-context.service'
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

    const memorySection = await taskContextService.buildMemorySectionForTask(
      task.id
    )

    return {
      taskId: task.id,
      taskIdentifier: task.identifier,
      taskTitle: task.title,
      retaggedEventCount: count,
      memorySection,
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
}
