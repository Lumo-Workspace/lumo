import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskService } from '@/lib/services/task.service'
import { taskContextService } from '@/lib/services/task-context.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import type { PreviousSessionRecovery } from '@/lib/services/task-context.service'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'

interface BindSessionToTaskInput {
  identity: VerifyApiKeyResult
  sessionId: string
  taskIdentifier: string
}

export type BindSessionToTaskResult = {
  status: 'bound'
  taskId: string
  taskIdentifier: string
  taskTitle: string
  /** Number of HookEvent rows whose null taskId was just filled in by this call. Zero means the session had no untagged events (often the case on re-attach or first-time attach before any hook fires). */
  retaggedEventCount: number
  /** Rendered memory section markdown for the bound task. Empty string when the task has no associated memories. */
  memorySection: string
  /** Rendered acceptance-contract markdown (or the draft nudge for an open task without criteria). Empty string for DONE tasks without criteria (LUM-342). */
  criteriaSection: string
  /** Recovery card data from the previous session on this task, or null if there is no prior session. */
  previousSession: PreviousSessionRecovery | null
  /** Rendered blocker-warning markdown for the bound task (LUM-172). Empty string when there is nothing to warn about. */
  blockerWarningSection: string
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

    // Hard lock (LUM-459): a session's taskId is write-once. If it is already
    // bound to a *different* task, refuse permanently — no force, no prompt.
    // Member-scoped read: a session owned by another member reads back null
    // here and is rejected by the ownedByOther guard below (403, no leak).
    // Re-binding to the SAME task is idempotent and falls through to the upsert.
    const current = await sessionRepository.findForMemberWithBinding(
      sessionId,
      memberId
    )
    if (current?.task && current.task.id !== task.id) {
      const currentTaskIdentifier = `${current.task.team.identifier}-${current.task.number}`
      throw Object.assign(
        new Error(`Session is permanently bound to ${currentTaskIdentifier}`),
        {
          status: 409,
          currentTaskIdentifier,
          currentTaskTitle: current.task.title,
        }
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

    const [
      memorySection,
      criteriaSection,
      previousSession,
      blockerWarningSection,
    ] = await Promise.all([
      taskContextService.buildMemorySectionForTask(task.id),
      taskContextService.buildCriteriaSectionForTask(task.id),
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
      criteriaSection,
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
}
