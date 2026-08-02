import type { TaskStatus } from '@prisma/client'

/**
 * Deadline-based health light for a milestone, inferred from its target date
 * and task progress. Distinct from the project-level `RiskLevel` in
 * `@/types/summary` (which scores throughput/staleness signals): this only
 * answers "is this milestone on schedule to hit its target date?".
 */
export type MilestoneHealth = 'on-track' | 'at-risk' | 'overdue'

export interface MilestoneHealthInput {
  /**
   * The derived completion stamp (LUM-714). Non-null = the milestone is done;
   * no schedule light applies. Replaces the COMPLETED/CANCELLED status check —
   * a cancelled milestone is an archived one now, and `archived` covers it.
   */
  completedAt: Date | null
  /** Archived milestones are put away by a human; no light applies. */
  archived: boolean
  startDate: Date | null
  targetDate: Date | null
  /** Number of DONE tasks under the milestone. */
  done: number
  /** Total tasks under the milestone (all statuses). */
  total: number
  /** Reference "now" — passed in so the computation stays deterministic. */
  now: Date
}

/** Completion is allowed to lag elapsed-time by this fraction before at-risk. */
export const SCHEDULE_SLIP = 0.2
/** Within this many days of the target (no start date) → at-risk. */
export const NEAR_DEADLINE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Returns the milestone's health light, or `null` when a light does not apply
 * (completed, archived, or no target date to measure against).
 *
 *  - `overdue`   — past the END of the target day with tasks still open
 *  - `at-risk`   — behind schedule (completion lags elapsed time) or, when no
 *                  start date is set, the deadline is within the near-deadline
 *                  window with work remaining
 *  - `on-track`  — everything else (including fully-done milestones)
 *
 * Calendar-day semantics (LUM-636): the target date is a calendar day stored
 * at UTC midnight, and "hit the target" means "done before that day ENDS" —
 * so every deadline comparison uses the end of the target day (`target +
 * 1 day`, UTC), never the stored midnight instant. Comparing against raw
 * midnight made the whole target day read as overdue the moment it started —
 * a full day early for viewers west of UTC.
 */
export function computeMilestoneHealth(
  input: MilestoneHealthInput
): MilestoneHealth | null {
  const { completedAt, archived, startDate, targetDate, done, total, now } =
    input

  // A health light only makes sense for in-flight milestones with a target.
  if (completedAt !== null || archived) return null
  if (!targetDate) return null

  // Work is finished — never warn, even if the target date slipped by.
  const allDone = total > 0 && done >= total
  if (allDone) return 'on-track'

  // The deadline instant: the target calendar day is fully inside the
  // schedule; overdue begins when the NEXT UTC day starts.
  const targetEnd = targetDate.getTime() + DAY_MS

  // Past the end of the target day with tasks still open.
  if (now.getTime() >= targetEnd) return 'overdue'

  const progressFraction = total > 0 ? done / total : 0

  // Primary signal: completion lagging behind elapsed schedule. Requires a
  // usable [start, end-of-target-day] window — a same-day start/target is a
  // valid one-day window.
  if (startDate && targetEnd > startDate.getTime()) {
    const elapsedFraction = clamp01(
      (now.getTime() - startDate.getTime()) / (targetEnd - startDate.getTime())
    )
    return progressFraction < elapsedFraction - SCHEDULE_SLIP
      ? 'at-risk'
      : 'on-track'
  }

  // Fallback (no usable start date): warn once the deadline is near.
  const daysToTarget = (targetEnd - now.getTime()) / DAY_MS
  return daysToTarget <= NEAR_DEADLINE_DAYS ? 'at-risk' : 'on-track'
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/**
 * Convenience wrapper for the API enrichment path: derive `done`/`total` from
 * the per-status task counts the routes already fetch, then compute health.
 */
export function milestoneHealthFromCounts(
  milestone: {
    completedAt: Date | null
    archivedAt: Date | null
    startDate: Date | null
    targetDate: Date | null
  },
  taskCounts: Record<TaskStatus, number>,
  now: Date
): MilestoneHealth | null {
  const total =
    taskCounts.TODO +
    taskCounts.IN_PROGRESS +
    taskCounts.IN_REVIEW +
    taskCounts.DONE
  return computeMilestoneHealth({
    completedAt: milestone.completedAt,
    archived: milestone.archivedAt !== null,
    startDate: milestone.startDate,
    targetDate: milestone.targetDate,
    done: taskCounts.DONE,
    total,
    now,
  })
}
