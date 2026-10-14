import type { TaskStatus } from '@prisma/client'

/**
 * Task-completion rollup for milestones (LUM-624, reshaped by LUM-714). Pure
 * decision logic — IO lives in `@/lib/services/milestone-rollup.service`.
 *
 * Since LUM-714 a milestone has no stored status. Its state is just:
 *
 *  - **archived** (`archivedAt`) — the one explicit human choice: put it away.
 *  - **completed** (`completedAt`) — never chosen, always *derived* from task
 *    completion and merely materialized as a timestamp.
 *
 * So the rollup no longer moves a milestone between lifecycle labels; it
 * answers one question — does the stored `completedAt` still agree with the
 * tasks?
 *
 *  - `complete` — every task is DONE (total > 0) and `completedAt` is unset
 *  - `reopen`   — a non-DONE task (re)appeared while `completedAt` was set
 *
 * Archived milestones are left alone (a human put them away; task churn
 * underneath must not resurrect them), and a milestone with zero tasks carries
 * no signal in either direction.
 */

/** The completion transition the task counts call for. */
export type MilestoneCompletionChange = 'complete' | 'reopen'

export interface MilestoneRollupInput {
  /** The stored completion stamp — `null` means "not completed". */
  completedAt: Date | null
  archived: boolean
  taskCounts: Record<TaskStatus, number>
  /**
   * LUM-643 → LUM-1135: how many items hold the close gate — unresolved exit
   * criteria plus milestone test cases that have not passed (positive proof).
   * While > 0 the close gate holds: an all-tasks-DONE milestone is
   * NOT auto-completed (and reads report no completion drift) until the
   * contract is adjudicated or a human overrides explicitly. Omitted → 0
   * (no contract = gate open), preserving pre-LUM-643 caller behavior.
   *
   * The gate is one-directional by design — it holds a completion shut, never
   * a `reopen`. Reopening restores a true statement about the tasks; blocking
   * it would strand a milestone stamped complete while work is demonstrably
   * open.
   */
  closeGateHeld?: number
}

/** Completion drift + missing-schedule hints surfaced on milestone reads. */
export interface MilestoneStaleness {
  /**
   * The completion transition the task counts call for, when the stored
   * `completedAt` disagrees with them; `null` when the two already agree.
   */
  completionDrift: MilestoneCompletionChange | null
  /**
   * True when the milestone is effectively in flight (not completed after
   * accounting for drift, not archived) but has no target date — the schedule
   * health light cannot be computed for it.
   */
  datesMissing: boolean
}

/**
 * Every task that counts toward completion is DONE, and there is at least one.
 * BACKLOG is not counted — a backlogged task is parked, neither holding the
 * milestone open nor making it complete (LUM-1057). The web page's "all tasks
 * DONE" (when Close anyway is offered) must agree with this, so both read it.
 */
export function allCountedTasksDone(
  taskCounts: Record<TaskStatus, number>
): boolean {
  const total =
    taskCounts.TODO +
    taskCounts.IN_PROGRESS +
    taskCounts.IN_REVIEW +
    taskCounts.DONE
  return total > 0 && taskCounts.DONE === total
}

/**
 * The completion transition the rollup rules call for, or `null` when none
 * applies (already consistent, archived, no tasks to read a signal from, or
 * held by the exit-criteria close gate).
 */
export function deriveCompletionChange(
  input: MilestoneRollupInput
): MilestoneCompletionChange | null {
  const { completedAt, archived, taskCounts } = input
  if (archived) return null

  const total =
    taskCounts.TODO +
    taskCounts.IN_PROGRESS +
    taskCounts.IN_REVIEW +
    taskCounts.DONE
  if (total === 0) return null

  if (allCountedTasksDone(taskCounts)) {
    if (completedAt !== null) return null
    // LUM-643 close gate: unresolved exit criteria / held test cases hold the auto-completion
    // shut — fail-closed, no transition (and no drift hint) until adjudicated.
    if ((input.closeGateHeld ?? 0) > 0) return null
    return 'complete'
  }

  // Tasks remain open — a stamped completion is no longer true.
  return completedAt !== null ? 'reopen' : null
}

/**
 * Staleness hints for a milestone read: stored-completion drift against the
 * task counts, and a missing target date on an in-flight milestone.
 * `datesMissing` is judged against the *effective* completion (post-drift), so
 * a milestone about to auto-complete doesn't nag about schedule dates.
 */
export function computeMilestoneStaleness(
  input: MilestoneRollupInput & { targetDate: Date | string | null }
): MilestoneStaleness {
  const completionDrift = deriveCompletionChange(input)
  const effectivelyCompleted =
    completionDrift === 'complete'
      ? true
      : completionDrift === 'reopen'
        ? false
        : input.completedAt !== null
  return {
    completionDrift,
    datesMissing:
      !input.archived && !effectivelyCompleted && input.targetDate == null,
  }
}
