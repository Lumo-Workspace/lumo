import type { MilestoneStatus, TaskStatus } from '@prisma/client'

/**
 * Deadline-based health light for a milestone, inferred from its target date
 * and task progress. Distinct from the project-level `RiskLevel` in
 * `@/types/summary` (which scores throughput/staleness signals): this only
 * answers "is this milestone on schedule to hit its target date?".
 */
export type MilestoneHealth = 'on-track' | 'at-risk' | 'overdue'

export interface MilestoneHealthInput {
  status: MilestoneStatus
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
 * (terminal status, or no target date to measure against).
 *
 *  - `overdue`   — past the target date with tasks still open
 *  - `at-risk`   — behind schedule (completion lags elapsed time) or, when no
 *                  start date is set, the target is within the near-deadline
 *                  window with work remaining
 *  - `on-track`  — everything else (including fully-done milestones)
 */
export function computeMilestoneHealth(
  input: MilestoneHealthInput
): MilestoneHealth | null {
  const { status, startDate, targetDate, done, total, now } = input

  // A health light only makes sense for in-flight milestones with a target.
  if (status === 'COMPLETED' || status === 'CANCELLED') return null
  if (!targetDate) return null

  // Work is finished — never warn, even if the target date slipped by.
  const allDone = total > 0 && done >= total
  if (allDone) return 'on-track'

  // Past the target date with tasks still open.
  if (now.getTime() > targetDate.getTime()) return 'overdue'

  const progressFraction = total > 0 ? done / total : 0

  // Primary signal: completion lagging behind elapsed schedule. Requires a
  // usable [start, target] window.
  if (startDate && targetDate.getTime() > startDate.getTime()) {
    const elapsedFraction = clamp01(
      (now.getTime() - startDate.getTime()) /
        (targetDate.getTime() - startDate.getTime())
    )
    return progressFraction < elapsedFraction - SCHEDULE_SLIP
      ? 'at-risk'
      : 'on-track'
  }

  // Fallback (no usable start date): warn once the target is near.
  const daysToTarget = (targetDate.getTime() - now.getTime()) / DAY_MS
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
    status: MilestoneStatus
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
    status: milestone.status,
    startDate: milestone.startDate,
    targetDate: milestone.targetDate,
    done: taskCounts.DONE,
    total,
    now,
  })
}
