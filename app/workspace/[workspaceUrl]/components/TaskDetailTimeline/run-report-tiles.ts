import type { TaskAcceptanceStatusView } from '../../types'

/**
 * The Record tab's Run report KPI tiles (LUM-496 Task 4): PR iterations, R1
 * pass rate, cost, and rework, derived from the acceptance status view. Pure
 * — no intl, no fetching — so `RunReportTiles.tsx` only has to render what
 * this returns. Every field is `null` when the underlying signal was never
 * measured (LUM-566 honesty rule): a `null` must never render as `0`.
 */
export interface RunReportTiles {
  /** PRs opened across the task's attempts, from `struggleTrail.pullRequests`
   *  (chronological order, not sorted by number). `null` when there are none
   *  yet (older server with no `struggleTrail`, or a task with no PRs). */
  prIterations: { count: number; first: number; last: number } | null
  /** Round 1's pass rate (0–100, whole number), from the `verificationHistory`
   *  round with the smallest `round` number: `passed / (passed + failed) *
   *  100`. `null` when there is no round yet, or round 1 has no verdicts
   *  (`passed + failed === 0`) — never fabricated as 0%. */
  passRateR1: number | null
  /** `cost.tokenCost` — `null` when cost was never measured (no `cost` view,
   *  or a measured-but-unknown token spend), distinct from a measured 0. */
  costTokens: number | null
  /** `cost.activeTimeSec` — the agent's active (non-idle) seconds on this task
   *  (LUM-560/LUM-642), rendered as the Cost tile's second sub-caption so the
   *  reading the old `CostSection` carried survives the tile rewrite. `null`
   *  only when there is no `cost` view at all; once `cost` exists, 0 is a
   *  legitimate measured value. */
  activeTimeSec: number | null
  /** `cost.reworkRounds` — `null` only when there is no `cost` view at all
   *  (older server); once `cost` exists, 0 is a legitimate measured value. */
  rework: number | null
}

export function deriveRunReportTiles(
  data: TaskAcceptanceStatusView
): RunReportTiles {
  const pullRequests = data.struggleTrail?.pullRequests ?? []
  const prIterations =
    pullRequests.length > 0
      ? {
          count: pullRequests.length,
          first: pullRequests[0]!.number,
          last: pullRequests[pullRequests.length - 1]!.number,
        }
      : null

  const rounds = data.verificationHistory
  const round1 =
    rounds.length > 0
      ? rounds.reduce((min, r) => (r.round < min.round ? r : min))
      : null
  const round1Denominator = round1 ? round1.passed + round1.failed : 0
  const passRateR1 =
    round1 && round1Denominator > 0
      ? Math.round((round1.passed / round1Denominator) * 100)
      : null

  const cost = data.cost
  const costTokens = cost?.tokenCost ?? null
  const activeTimeSec = cost ? cost.activeTimeSec : null
  const rework = cost ? cost.reworkRounds : null

  return { prIterations, passRateR1, costTokens, activeTimeSec, rework }
}
