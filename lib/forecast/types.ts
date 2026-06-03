/** p25 / median / p75 over a numeric sample. */
export interface Interval {
  p25: number
  median: number
  p75: number
}

/** One completed candidate task as loaded from the DB (raw, pre-metrics). */
export interface ForecastCandidate {
  id: string
  title: string
  identifier: string // `${team.identifier}-${number}`, e.g. "LUM-42"
  tags: string[]
  agentRuns: { startedAt: Date; finishedAt: Date | null }[]
  mergedPrAt: (Date | null)[] // mergedAt of each merged PR
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
  sources: ForecastSource[]
}
