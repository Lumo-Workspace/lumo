import type { TaskStatusView } from '../../types'

/**
 * The Record tab's Run report KPI tiles (LUM-496 Task 4): PR iterations, cost,
 * and rework, derived from the task status view. Pure — no intl, no fetching —
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
  /** `trend.rework.total` — reopens + PR cycles beyond the first. */
  rework: number
}

export function deriveRunReportTiles(data: TaskStatusView): RunReportTiles {
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
    rework: data.trend.rework.total,
  }
}
