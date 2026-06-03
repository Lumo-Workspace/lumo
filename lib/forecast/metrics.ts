import type { ForecastCandidate, CandidateMetrics } from './types'

const MS_PER_HOUR = 1000 * 60 * 60

/**
 * Iterations = number of agent runs.
 * Merged PRs = number of merged-PR timestamps.
 * Cycle (hours) = first agent-run start → completion, where completion is the
 * latest merged-PR time, or (if none) the latest agent-run finishedAt.
 * Returns cycleHours = null when start or completion is unknown.
 */
export function extractMetrics(c: ForecastCandidate): CandidateMetrics {
  const iterations = c.agentRuns.length
  const mergedAts = c.mergedPrAt.filter((d): d is Date => d !== null)
  const mergedPrs = mergedAts.length

  const startTimes = c.agentRuns.map(r => r.startedAt.getTime())
  const start = startTimes.length ? Math.min(...startTimes) : null

  const finishTimes: number[] =
    mergedAts.length > 0
      ? mergedAts.map(d => d.getTime())
      : c.agentRuns
          .map(r => r.finishedAt)
          .filter((d): d is Date => d !== null)
          .map(d => d.getTime())
  const finish = finishTimes.length ? Math.max(...finishTimes) : null

  let cycleHours: number | null = null
  if (start !== null && finish !== null && finish >= start) {
    cycleHours = (finish - start) / MS_PER_HOUR
  }

  return { iterations, mergedPrs, cycleHours }
}
