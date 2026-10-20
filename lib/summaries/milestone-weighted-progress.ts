import type { TaskStatus } from '@prisma/client'
import { countsTowardCompletion } from '@/lib/task/status-semantics'

/**
 * LUM-650 — complexity-weighted progress reading for the milestone Overview
 * ring, alongside the plain task-count reading.
 *
 * A CURRENT-STATUS SNAPSHOT, deliberately not a backward-replay curve: the
 * ring answers "of the change surface we've measured, what fraction sits in
 * DONE tasks right now" — the same point-in-time basis the task-count ring
 * uses. The team's backward-replay convention governs cumulative-over-time
 * metrics (burnup/burndown/coverage); a single ring has no time axis, so
 * replaying it would be theater, not honesty. A weighted burnup over time
 * would be a separate feature that WOULD replay from the STATUS_CHANGED log.
 *
 * Three-state discipline (LUM-634, mirrored from the delivery-stats rollup):
 * a task with no TaskComplexity row is UNMEASURED — excluded from both sums
 * and counted only against coverage (`measuredTasks < totalTasks`), NEVER read
 * as a 0 weight. Zero measured tasks (or a measured total of 0 changed files)
 * yields a `null` pct — an explicit Unavailable, never a fabricated 0%.
 */

/** One member task projected to the weighted-progress fold. */
export interface WeightedProgressTaskRow {
  status: TaskStatus
  /** `TaskComplexity.changedFileCount`, or `null` when the task has no
   * complexity row (unmeasured — excluded from the sums, counted only against
   * coverage, never read as a 0 weight). */
  changedFileCount: number | null
}

export interface MilestoneWeightedProgress {
  /** Σ changedFileCount of DONE measured tasks. `null` when nothing measured. */
  doneWeight: number | null
  /** Σ changedFileCount of all measured tasks. `null` when nothing measured. */
  totalWeight: number | null
  /** Weighted completion percent (`Math.round`). `null` when unmeasured or
   * the measured total weight is 0 (an undefined ratio — Unavailable, never a
   * fake 0/100). */
  pct: number | null
  /** Tasks carrying a complexity row — the sum basis. */
  measuredTasks: number
  /** All member tasks — the coverage denominator. */
  totalTasks: number
}

export function computeWeightedProgress(
  tasks: WeightedProgressTaskRow[]
): MilestoneWeightedProgress {
  let doneWeight = 0
  let totalWeight = 0
  let measuredTasks = 0
  // LUM-1282: CANCELED is outside progress and the coverage denominator.
  const counted = tasks.filter(t => countsTowardCompletion(t.status))
  for (const t of counted) {
    // BACKLOG is unscheduled and outside progress (LUM-1057).
    if (t.changedFileCount === null || t.status === 'BACKLOG') continue
    measuredTasks++
    totalWeight += t.changedFileCount
    if (t.status === 'DONE') doneWeight += t.changedFileCount
  }
  const measured = measuredTasks > 0
  return {
    doneWeight: measured ? doneWeight : null,
    totalWeight: measured ? totalWeight : null,
    // totalWeight === 0 (all measured tasks touched 0 files) → undefined ratio.
    pct:
      measured && totalWeight > 0
        ? Math.round((doneWeight / totalWeight) * 100)
        : null,
    measuredTasks,
    totalTasks: counted.length,
  }
}
