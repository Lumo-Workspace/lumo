import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { taskService } from '@/lib/services/task.service'
import { taskContextService } from '@/lib/services/task-context.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import { prSecurityReminderService } from '@/lib/services/pr-security-reminder.service'
import type { PreviousSessionRecovery } from '@/lib/services/task-context.service'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'
import type { TaskStatusForNextSteps } from '@/lib/context/render/next-steps'

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
  /** LUM-807: rendered "## Test cases" nudge. Empty once a script exists (and on DONE). */
  testCaseSection: string
  /** Recovery card data from the previous session on this task, or null if there is no prior session. */
  previousSession: PreviousSessionRecovery | null
  /** Rendered blocker-warning markdown for the bound task (LUM-172). Empty string when there is nothing to warn about. */
  blockerWarningSection: string
  /** LUM-737: undispositioned security findings on the task's PRs. Empty string when there is nothing to show. */
  securityFindingsSection: string
  /** Post-bind task status. Surfaced so the route can compute next steps without a second read (LUM-686). */
  taskStatus: TaskStatusForNextSteps
}

interface BindSessionToMilestoneInput {
  identity: VerifyApiKeyResult
  sessionId: string
  /** Milestone reference: exact id, or a case-insensitive name/slug match. */
  milestoneRef: string
}

export type BindSessionToMilestoneResult = {
  status: 'bound'
  role: 'STEWARD'
  milestoneId: string
  milestoneName: string
  /**
   * LUM-647: prior-milestone learnings injected at steward start — the
   * MILESTONE-scope memories distilled from this project's earlier milestone-close
   * retros, wrapped in the untrusted-team-memory boundary. Empty string when the
   * project has no prior distilled learnings.
   */
  stewardMemorySection: string
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
      /** LUM-640: STEWARD when the session is milestone-bound. Absent/IMPLEMENTATION otherwise. */
      role: 'IMPLEMENTATION' | 'STEWARD'
      /** LUM-640: the bound milestone's name for STEWARD sessions, else null. */
      milestoneName: string | null
    }

/**
 * Resolve a milestone reference workspace-wide (LUM-640): exact id first, then
 * a case-insensitive name/slug match across the workspace's active milestones.
 * Ambiguous references are rejected with the candidate list (the workspace
 * convention for user-supplied identifiers) — the caller retries with the id.
 */
async function resolveMilestoneInWorkspace(
  workspaceId: string,
  milestoneRef: string
): Promise<{ id: string; name: string }> {
  const ref = milestoneRef.trim()
  const byId = await milestoneRepository.findById(ref)
  if (byId) {
    // Guard the workspace boundary: an id from another workspace must read as
    // not-found, not leak the milestone's existence.
    const inWorkspace = await milestoneRepository.findByWorkspace(
      workspaceId,
      'all'
    )
    const match = inWorkspace.find(m => m.id === byId.id)
    if (match) return { id: match.id, name: match.name }
  }
  const candidates = await milestoneRepository.findByWorkspace(
    workspaceId,
    'active'
  )
  const lowered = ref.toLowerCase()
  const matches = candidates.filter(
    m => m.name.toLowerCase() === lowered || m.slug.toLowerCase() === lowered
  )
  if (matches.length === 0) {
    throw Object.assign(
      new Error(
        `No milestone matches "${milestoneRef}" in this workspace. Try \`lumo milestone list\`.`
      ),
      { status: 404 }
    )
  }
  if (matches.length > 1) {
    const list = matches.map(m => `${m.id} "${m.name}"`).join(', ')
    throw Object.assign(
      new Error(
        `Milestone reference "${milestoneRef}" is ambiguous — matches: ${list}. Use the milestone id.`
      ),
      { status: 400 }
    )
  }
  const only = matches[0]
  if (!only) {
    // Unreachable (length === 1) — satisfies noUncheckedIndexedAccess.
    throw Object.assign(new Error('Milestone resolution failed'), {
      status: 500,
    })
  }
  return { id: only.id, name: only.name }
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
    // LUM-640: a STEWARD session is milestone-bound for its lifetime — the same
    // lock as taskId, in the other legal form. It never converts to an
    // implementation session; a task attach is refused outright.
    if (current?.role === 'STEWARD' && current.milestone) {
      throw Object.assign(
        new Error(
          `Session is a STEWARD (governance) session for milestone "${current.milestone.name}" — it cannot attach a task. Start a new Claude Code session to implement ${taskIdentifier}.`
        ),
        {
          status: 409,
          currentMilestoneId: current.milestone.id,
          currentMilestoneName: current.milestone.name,
          sessionRole: 'STEWARD',
        }
      )
    }
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
      testCaseSection,
      previousSession,
      blockerWarningSection,
      securityFindingsSection,
    ] = await Promise.all([
      taskContextService.buildMemorySectionForTask(task.id),
      taskContextService.buildCriteriaSectionForTask(task.id),
      // LUM-807: sits beside the contract — same moment, different question.
      taskContextService.buildTestCaseSectionForTask(
        task.id,
        task.identifier,
        task.status
      ),
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
      // LUM-737: best-effort — a scan read failure must not break attach.
      prSecurityReminderService
        .buildSessionStartSection(task.id, task.identifier)
        .catch(() => ''),
    ])

    return {
      status: 'bound',
      taskId: task.id,
      taskIdentifier: task.identifier,
      taskTitle: task.title,
      retaggedEventCount: count,
      memorySection,
      criteriaSection,
      testCaseSection,
      previousSession,
      blockerWarningSection,
      securityFindingsSection,
      taskStatus: task.status as TaskStatusForNextSteps,
    }
  },

  /**
   * Bind a session to a MILESTONE as a STEWARD (governance) session (LUM-640).
   * The steward binding is the second legal session form: same lifetime-lock
   * semantics as the task binding (LUM-459) — a task-bound session cannot
   * become a steward, a steward cannot rebind to a different milestone, and
   * re-attaching the same milestone is an idempotent no-op. Multiple steward
   * sessions on one milestone are allowed (acceptance is multi-round by
   * nature), so there is no uniqueness check across sessions.
   */
  async bindSessionToMilestone({
    identity,
    sessionId,
    milestoneRef,
  }: BindSessionToMilestoneInput): Promise<BindSessionToMilestoneResult> {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) {
      throw Object.assign(new Error('Not a workspace member'), { status: 403 })
    }

    const milestone = await resolveMilestoneInWorkspace(
      identity.workspace.id,
      milestoneRef
    )

    const current = await sessionRepository.findForMemberWithBinding(
      sessionId,
      memberId
    )
    // Lifetime lock, task form: an implementation session never becomes a
    // steward. Mirrors the LUM-459 refusal shape so the CLI can name the task.
    if (current?.task) {
      const currentTaskIdentifier = `${current.task.team.identifier}-${current.task.number}`
      throw Object.assign(
        new Error(
          `Session is permanently bound to ${currentTaskIdentifier} — an implementation session cannot become a steward. Start a new Claude Code session for governance work.`
        ),
        {
          status: 409,
          currentTaskIdentifier,
          currentTaskTitle: current.task.title,
        }
      )
    }
    // Lifetime lock, milestone form: bound to a DIFFERENT milestone → refuse;
    // the SAME milestone falls through (idempotent re-attach).
    if (
      current?.role === 'STEWARD' &&
      current.milestone &&
      current.milestone.id !== milestone.id
    ) {
      throw Object.assign(
        new Error(
          `Session is permanently bound as STEWARD of milestone "${current.milestone.name}" — start a new Claude Code session to steward a different milestone.`
        ),
        {
          status: 409,
          currentMilestoneId: current.milestone.id,
          currentMilestoneName: current.milestone.name,
          sessionRole: 'STEWARD',
        }
      )
    }

    const upserted = await sessionRepository.upsertWithMilestoneId({
      id: sessionId,
      workspaceId: identity.workspace.id,
      workspaceMemberId: memberId,
      milestoneId: milestone.id,
      now: new Date(),
    })
    if (upserted.ownedByOther) {
      throw Object.assign(new Error('Session belongs to another member'), {
        status: 403,
      })
    }

    // LUM-647: inject this project's prior-milestone learnings at steward start.
    // Best-effort — a rendering failure must never fail the bind (the lifetime
    // lock has already committed above), so it degrades to an empty section.
    let stewardMemorySection = ''
    try {
      const { stewardContextService } =
        await import('@/lib/services/steward-context.service')
      const built = await stewardContextService.buildMilestoneMemorySection(
        milestone.id
      )
      stewardMemorySection = built.section
      // LUM-648: birth one cross-milestone learning edge per prior-milestone
      // memory actually injected — the usage-vote substrate the milestone-close
      // audit later stamps. Isolated best-effort so it can never disturb the
      // rendered section or fail the bind; idempotent on re-attach (skipDuplicates).
      if (built.memories.length > 0) {
        try {
          const { milestoneMemoryEdgeRepository } =
            await import('@/lib/repositories/milestone-memory-edge.repository')
          await milestoneMemoryEdgeRepository.recordInjection({
            workspaceId: identity.workspace.id,
            consumerMilestoneId: milestone.id,
            sessionId,
            rows: built.memories,
          })
        } catch (err) {
          console.error(
            'LUM-648 milestone memory edge birth (bind) failed:',
            err
          )
        }
      }
    } catch {
      stewardMemorySection = ''
    }

    return {
      status: 'bound',
      role: 'STEWARD',
      milestoneId: milestone.id,
      milestoneName: milestone.name,
      stewardMemorySection,
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
      role: row.role,
      milestoneName: row.milestone?.name ?? null,
    }
  },
}
