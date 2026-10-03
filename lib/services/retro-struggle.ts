import type { StruggleTrail } from '@/lib/services/task-status.service'

/**
 * The per-task slice the cross-task retro aggregator consumes — a strict subset
 * of {@link TaskStatusReport} (LUM-561). Typed against the same source the
 * per-task report reads so a milestone/sprint retro cannot drift from
 * `lumo task status`: the negative-class numbers are rolled up, never
 * re-derived from a parallel query.
 */
export interface RetroStruggleInput {
  task: { identifier: string; title: string }
  struggleTrail: StruggleTrail
}

/** Per-task detail for the hard tasks — lets the retro name *where* the work
 *  was hard instead of only reporting a milestone-wide count. */
export interface HardTaskDetail {
  identifier: string
  title: string
  reopens: number
  extraPrCycles: number
}

/**
 * The milestone/sprint-level rollup of the negative-class struggle signals
 * (LUM-506): reopens and extra PR cycles a clean all-green title list would
 * otherwise wipe. An all-zero aggregate is a legitimate (honest) state — the
 * renderer must still state the basis rather than dropping the section.
 */
export interface RetroStruggleAggregate {
  /** Tasks the aggregate covers. */
  tasksConsidered: number
  /** Tasks carrying ≥1 negative signal (reopen / extra PR cycle). */
  tasksWithStruggle: number
  /** Σ status reopens (review/done → in-progress/todo). */
  reopens: number
  /** Σ PR cycles beyond the first per task (>1 PR is the churn signal). */
  extraPrCycles: number
  /** The struggling tasks, with per-task detail, for naming the hard work. */
  hardTasks: HardTaskDetail[]
}

/**
 * Roll up the per-task struggle signals into the milestone/sprint aggregate.
 * Pure (no IO) so it is fully unit-testable; the services feed it the result of
 * {@link taskStatusService.statusForTask} per task.
 */
export function aggregateRetroStruggle(
  statuses: RetroStruggleInput[]
): RetroStruggleAggregate {
  const agg: RetroStruggleAggregate = {
    tasksConsidered: statuses.length,
    tasksWithStruggle: 0,
    reopens: 0,
    extraPrCycles: 0,
    hardTasks: [],
  }

  for (const s of statuses) {
    const reopens = s.struggleTrail.reopens.length
    const extraPrCycles = Math.max(0, s.struggleTrail.pullRequests.length - 1)

    agg.reopens += reopens
    agg.extraPrCycles += extraPrCycles

    if (reopens > 0 || extraPrCycles > 0) {
      agg.tasksWithStruggle += 1
      agg.hardTasks.push({
        identifier: s.task.identifier,
        title: s.task.title,
        reopens,
        extraPrCycles,
      })
    }
  }

  return agg
}
