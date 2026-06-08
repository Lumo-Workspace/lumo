import { forecastRepository } from '@/lib/repositories/forecast.repository'
import { scoreCandidate } from '@/lib/forecast/score'
import { extractMetrics } from '@/lib/forecast/metrics'
import { interval } from '@/lib/forecast/percentile'
import { deriveConfidence } from '@/lib/forecast/confidence'
import type {
  TaskForecast,
  ForecastSource,
  ForecastCandidate,
} from '@/lib/forecast/types'

const SCORE_THRESHOLD = 0.3
const MAX_COHORT = 20
const MIN_COHORT = 3

const EMPTY: TaskForecast = {
  insufficientData: true,
  cohortSize: 0,
  iterations: null,
  mergedPrs: null,
  cycleHours: null,
  tokenCost: null,
  tokenCostBasis: 0,
  confidence: 'low',
  sources: [],
}

/**
 * Token-cost forecast, computed project-wide over ALL completed candidate
 * tasks that carry usage data — deliberately NOT restricted to the similarity
 * cohort. Offline analysis (LUM-304) showed no a-priori task feature predicts
 * cost, so a narrow same-title cohort adds noise rather than signal; the larger
 * project-wide sample is the more honest, more stable basis. Only ~10% of tasks
 * have cost data today, so this surfaces a count caveat instead of pretending
 * to per-task precision.
 */
function tokenForecast(candidates: ForecastCandidate[]): {
  tokenCost: TaskForecast['tokenCost']
  tokenCostBasis: number
} {
  const costs = candidates
    .map(c => c.tokenCost)
    .filter((v): v is number => v !== null)
  if (costs.length < MIN_COHORT) return { tokenCost: null, tokenCostBasis: 0 }
  return { tokenCost: interval(costs), tokenCostBasis: costs.length }
}

export const forecastService = {
  /**
   * Retrieve a delivery forecast for a task from similar completed tasks'
   * real execution data. Deterministic — no LLM, no hidden points.
   *
   * Two independent tracks:
   *  - iterations / mergedPrs / cycleHours: from the similarity cohort
   *    (same-project completed tasks scoring ≥ threshold on title+tags).
   *  - tokenCost: project-wide over tasks with usage data (see tokenForecast).
   * The panel is shown when EITHER track produces output.
   */
  async getTaskForecast(taskId: string): Promise<TaskForecast> {
    const inputs = await forecastRepository.loadForecastInputs(taskId)
    if (!inputs) return EMPTY

    const { tokenCost, tokenCostBasis } = tokenForecast(inputs.candidates)

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

    // Too few similar tasks for the cohort metrics — but a project-wide token
    // forecast may still be available, so only declare "insufficient" when
    // BOTH tracks are empty.
    if (sources.length < MIN_COHORT) {
      // Cohort metrics are absent here, so only the token track (if any) backs
      // the badge.
      return {
        insufficientData: tokenCost === null,
        cohortSize: sources.length,
        iterations: null,
        mergedPrs: null,
        cycleHours: null,
        tokenCost,
        tokenCostBasis,
        confidence: deriveConfidence(tokenCost ? [tokenCostBasis] : []),
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
      tokenCost,
      tokenCostBasis,
      // Both tracks may back the badge; take the strongest leg.
      confidence: deriveConfidence([
        sources.length,
        ...(tokenCost ? [tokenCostBasis] : []),
      ]),
      sources,
    }
  },
}
