import type { TaskStatusView } from '../../types'

/**
 * The Record tab's Run overview tiles (LUM-496 Task 4, LUM-1009): cost, PR
 * iterations and sessions, derived from the task status view plus the runs'
 * attribution summary. Pure — no intl, no fetching —
 * so `RunReportTiles.tsx` only has to render what this returns. Every field is
 * `null` when the underlying signal was never measured (LUM-566 honesty rule):
 * a `null` must never render as `0`.
 */
export interface RunReportTiles {
  /** PRs opened across the task's attempts, from `struggleTrail.pullRequests`
   *  (chronological order, not sorted by number). `null` when there are none. */
  prIterations: { count: number; first: number; last: number } | null
  /** `cost.tokenCost` — `null` when cost was never measured, distinct from a
   *  measured 0. */
  costTokens: number | null
  /** `cost.activeTimeSec` — the agent's active (non-idle) seconds on this task
   *  (LUM-560/LUM-642), rendered as the Cost tile's second sub-caption. */
  activeTimeSec: number
  /** LUM-1009: sessions that did work on the task, split by how they were
   *  attributed (`lumo session attach` vs auto-detected). `null` when no run
   *  has attributed work. */
  sessions: { explicit: number; inferred: number } | null
}

export function deriveRunReportTiles(
  data: TaskStatusView,
  attribution: { explicit: number; inferred: number }
): RunReportTiles {
  const pullRequests = data.struggleTrail.pullRequests
  const prIterations =
    pullRequests.length > 0
      ? {
          count: pullRequests.length,
          first: pullRequests[0]!.number,
          last: pullRequests[pullRequests.length - 1]!.number,
        }
      : null

  return {
    prIterations,
    costTokens: data.cost.tokenCost,
    activeTimeSec: data.cost.activeTimeSec,
    sessions:
      attribution.explicit + attribution.inferred > 0
        ? { explicit: attribution.explicit, inferred: attribution.inferred }
        : null,
  }
}
