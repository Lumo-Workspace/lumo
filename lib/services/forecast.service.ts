import { forecastRepository } from '@/lib/repositories/forecast.repository'
import { scoreCandidate } from '@/lib/forecast/score'
import { extractMetrics } from '@/lib/forecast/metrics'
import { interval } from '@/lib/forecast/percentile'
import type { TaskForecast, ForecastSource } from '@/lib/forecast/types'

const SCORE_THRESHOLD = 0.3
const MAX_COHORT = 20
const MIN_COHORT = 3

const EMPTY: TaskForecast = {
  insufficientData: true,
  cohortSize: 0,
  iterations: null,
  mergedPrs: null,
  cycleHours: null,
  sources: [],
}

export const forecastService = {
  /**
   * Retrieve a delivery forecast for a task from similar completed tasks'
   * real execution data. Deterministic — no LLM, no hidden points.
   */
  async getTaskForecast(taskId: string): Promise<TaskForecast> {
    const inputs = await forecastRepository.loadForecastInputs(taskId)
    if (!inputs) return EMPTY

    const cohort = inputs.candidates
      .map(c => ({ candidate: c, score: scoreCandidate(inputs.target, c) }))
      .filter(s => s.score >= SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_COHORT)

    const sources: ForecastSource[] = cohort.map(({ candidate, score }) => {
      const m = extractMetrics(candidate)
      return {
        taskId: candidate.id,
        identifier: candidate.identifier,
        title: candidate.title,
        iterations: m.iterations,
        mergedPrs: m.mergedPrs,
        cycleHours: m.cycleHours,
        score,
      }
    })

    if (sources.length < MIN_COHORT) {
      return {
        insufficientData: true,
        cohortSize: sources.length,
        iterations: null,
        mergedPrs: null,
        cycleHours: null,
        sources: sources.slice(0, 2),
      }
    }

    const cycleValues = sources
      .map(s => s.cycleHours)
      .filter((v): v is number => v !== null)

    return {
      insufficientData: false,
      cohortSize: sources.length,
      iterations: interval(sources.map(s => s.iterations)),
      mergedPrs: interval(sources.map(s => s.mergedPrs)),
      cycleHours:
        cycleValues.length >= MIN_COHORT ? interval(cycleValues) : null,
      sources,
    }
  },
}
