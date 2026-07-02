import type { MilestoneStatus, TaskStatus } from '@prisma/client'

/**
 * Task-completion status rollup for milestones (LUM-624). Pure decision
 * logic — IO lives in `@/lib/services/milestone-rollup.service`.
 *
 * A milestone's PLANNED/ACTIVE/COMPLETED lifecycle follows its tasks:
 *
 *  - PLANNED  → ACTIVE     any task has started (left TODO), not all done
 *  - PLANNED/ACTIVE → COMPLETED   every task is DONE (total > 0)
 *  - COMPLETED → ACTIVE    a non-DONE task (re)appeared — reopened, created,
 *                          or moved in
 *
 * CANCELLED and archived milestones are human terminal choices — rollup
 * never touches them. A milestone with zero tasks carries no signal and is
 * never moved either direction.
 */

export interface MilestoneRollupInput {
  status: MilestoneStatus
  archived: boolean
  taskCounts: Record<TaskStatus, number>
}

/** Status drift + missing-schedule hints surfaced on milestone reads. */
export interface MilestoneStaleness {
  /**
   * The status the task counts say the milestone should be in, when it
   * differs from the stored one; `null` when stored status matches reality.
   */
  statusDrift: MilestoneStatus | null
  /**
   * True when the milestone is effectively in flight (non-terminal after
   * accounting for drift) but has no target date — the schedule health
   * light cannot be computed for it.
   */
  datesMissing: boolean
}

/**
 * The status the rollup rules would move the milestone to, or `null` when no
 * automatic transition applies (already consistent, terminal by human choice,
 * archived, or no tasks to read a signal from).
 */
export function deriveRollupStatus(
  input: MilestoneRollupInput
): MilestoneStatus | null {
  const { status, archived, taskCounts } = input
  if (archived || status === 'CANCELLED') return null

  const total =
    taskCounts.TODO +
    taskCounts.IN_PROGRESS +
    taskCounts.IN_REVIEW +
    taskCounts.DONE
  if (total === 0) return null

  const allDone = taskCounts.DONE === total
  if (allDone) return status === 'COMPLETED' ? null : 'COMPLETED'

  // Tasks remain open from here on.
  if (status === 'COMPLETED') return 'ACTIVE'
  const started =
    taskCounts.IN_PROGRESS + taskCounts.IN_REVIEW + taskCounts.DONE > 0
  if (status === 'PLANNED' && started) return 'ACTIVE'
  return null
}

/**
 * Staleness hints for a milestone read: stored-status drift against the
 * task-derived status, and a missing target date on an in-flight milestone.
 * `datesMissing` is judged against the *effective* status (post-drift), so a
 * milestone about to auto-complete doesn't nag about schedule dates.
 */
export function computeMilestoneStaleness(
  input: MilestoneRollupInput & { targetDate: Date | string | null }
): MilestoneStaleness {
  const statusDrift = deriveRollupStatus(input)
  const effectiveStatus = statusDrift ?? input.status
  const terminal =
    effectiveStatus === 'COMPLETED' || effectiveStatus === 'CANCELLED'
  return {
    statusDrift,
    datesMissing: !input.archived && !terminal && input.targetDate == null,
  }
}
