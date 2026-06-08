/** p25 / median / p75 over a numeric sample. */
export interface Interval {
  p25: number
  median: number
  p75: number
}

/**
 * How much historical evidence backs the forecast. Derived from the sample
 * sizes feeding the displayed tracks (see deriveConfidence) — NOT a model
 * probability. Surfaced as a neutral badge so readers can calibrate trust.
 */
export type ForecastConfidence = 'low' | 'medium' | 'high'

/** One completed candidate task as loaded from the DB (raw, pre-metrics). */
export interface ForecastCandidate {
  id: string
  title: string
  identifier: string // `${team.identifier}-${number}`, e.g. "LUM-42"
  tags: string[]
  // Source-agnostic execution runs. Today these are Claude Code Sessions
  // (finishedAt = session.lastActivityAt); historically they were AgentRuns.
  // The repository owns the source→run mapping so this layer stays agnostic.
  runs: { startedAt: Date; finishedAt: Date | null }[]
  mergedPrAt: (Date | null)[] // mergedAt of each merged PR
  // Total token cost = sum of input+output+cache tokens across the task's
  // sessions. null when no session carries usage data (historical rows, or
  // sessions that never reached a STOP with usage). Only ~10% of tasks have
  // this today, so the token forecast is computed project-wide, not per-cohort.
  tokenCost: number | null
  // Count of AGENT_CLARIFY notifications raised for this task (LUM-319).
  // The clarify forecast track; 0 for tasks that never needed clarification.
  clarifyRounds: number
}

export interface ForecastInputs {
  target: { id: string; title: string; tags: string[]; projectId: string }
  candidates: ForecastCandidate[]
}

/** Metrics extracted from one candidate. */
export interface CandidateMetrics {
  iterations: number
  mergedPrs: number
  cycleHours: number | null
  tokenCost: number | null
  clarifyRounds: number
}

/** A historical task that contributed to the interval (explainability). */
export interface ForecastSource {
  taskId: string
  identifier: string
  title: string
  iterations: number
  mergedPrs: number
  cycleHours: number | null
  score: number
}

export interface TaskForecast {
  insufficientData: boolean
  cohortSize: number
  iterations: Interval | null
  mergedPrs: Interval | null
  cycleHours: Interval | null
  // Token-cost forecast, computed project-wide over completed tasks that carry
  // usage data (NOT the similarity cohort — no a-priori feature predicts cost,
  // so the broader, more stable sample wins). null when fewer than the minimum
  // such tasks exist. tokenCostBasis = how many tasks fed the interval (shown
  // as an honest "based on N tasks with cost data" caveat).
  tokenCost: Interval | null
  tokenCostBasis: number
  // Clarification-rounds forecast over the similarity cohort (LUM-319), same
  // cohort + MIN_COHORT gating as iterations. null when the cohort is too thin.
  clarifyRounds: Interval | null
  // Evidence-strength badge, derived from the sample sizes behind the shown
  // tracks. 'low' when insufficientData (no badge is rendered in that case).
  confidence: ForecastConfidence
  sources: ForecastSource[]
}
