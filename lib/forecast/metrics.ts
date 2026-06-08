import type { ForecastCandidate, CandidateMetrics } from './types'

const MS_PER_HOUR = 1000 * 60 * 60

/**
 * Iterations = number of runs (Claude Code sessions for the task).
 * Merged PRs = number of merged-PR timestamps.
 * Cycle (hours) = first run start → completion, where completion is the
 * latest merged-PR time, or (if none) the latest run finishedAt
 * (= session.lastActivityAt).
 * Returns cycleHours = null when start or completion is unknown.
 */
export function extractMetrics(c: ForecastCandidate): CandidateMetrics {
  const iterations = c.runs.length
  const mergedAts = c.mergedPrAt.filter((d): d is Date => d !== null)
  const mergedPrs = mergedAts.length

  const startTimes = c.runs.map(r => r.startedAt.getTime())
  const start = startTimes.length ? Math.min(...startTimes) : null

  const finishTimes: number[] =
    mergedAts.length > 0
      ? mergedAts.map(d => d.getTime())
      : c.runs
          .map(r => r.finishedAt)
          .filter((d): d is Date => d !== null)
          .map(d => d.getTime())
  const finish = finishTimes.length ? Math.max(...finishTimes) : null

  let cycleHours: number | null = null
  if (start !== null && finish !== null && finish >= start) {
    cycleHours = (finish - start) / MS_PER_HOUR
  }

  return {
    iterations,
    mergedPrs,
    cycleHours,
    tokenCost: c.tokenCost,
    clarifyRounds: c.clarifyRounds,
  }
}
