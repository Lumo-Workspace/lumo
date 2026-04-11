import type {
  RiskAssessment,
  RiskLevel,
  RiskReason,
  RiskReasonCode,
  TaskSummaryStats,
  TopBlockers,
} from '@/types/summary'

export interface RiskConfig {
  overdueRatio: number
  stalledDays: number
  stalledMinCount: number
  agentFailRatio: number
  stalePrDays: number
  throughputDrop: number
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  overdueRatio: 0.25,
  stalledDays: 7,
  stalledMinCount: 3,
  agentFailRatio: 0.3,
  stalePrDays: 3,
  throughputDrop: 0.5,
}

const RISK_WEIGHTS: Record<RiskReasonCode, number> = {
  overdue_ratio_high: 3,
  stalled_tasks: 2,
  agent_failure_rate: 2,
  stale_open_prs: 1,
  throughput_drop: 2,
}

const RISK_BANDS = { HEALTHY_MAX: 2, WATCH_MAX: 4 } as const

interface WorkspaceRiskFields {
  riskOverdueRatio: number
  riskStalledDays: number
  riskStalledMinCount: number
  riskAgentFailRatio: number
  riskStalePrDays: number
  riskThroughputDrop: number
}

interface ProjectRiskFields {
  riskOverdueRatio: number | null
  riskStalledDays: number | null
  riskStalledMinCount: number | null
  riskAgentFailRatio: number | null
  riskStalePrDays: number | null
  riskThroughputDrop: number | null
}

export function resolveEffectiveRiskConfig(
  workspace: WorkspaceRiskFields,
  project: ProjectRiskFields | null
): RiskConfig {
  return {
    overdueRatio: project?.riskOverdueRatio ?? workspace.riskOverdueRatio,
    stalledDays: project?.riskStalledDays ?? workspace.riskStalledDays,
    stalledMinCount:
      project?.riskStalledMinCount ?? workspace.riskStalledMinCount,
    agentFailRatio: project?.riskAgentFailRatio ?? workspace.riskAgentFailRatio,
    stalePrDays: project?.riskStalePrDays ?? workspace.riskStalePrDays,
    throughputDrop: project?.riskThroughputDrop ?? workspace.riskThroughputDrop,
  }
}

// Placeholder exports — implemented in subsequent tasks.
export interface RiskSignals {
  stalledTaskCount: number
  staleOpenPrCount: number
  last7dCompleted: number
  prev7dCompleted: number
}

export function computeRisk(
  _stats: TaskSummaryStats,
  _signals: RiskSignals,
  _config: RiskConfig
): RiskAssessment {
  throw new Error('computeRisk not implemented')
}

export function collectTopBlockers(_input: {
  tasks: Array<{
    id: string
    status: string
    dueDate: Date | null
    updatedAt: Date
  }>
  agents: Array<{ taskId: string; agentStatus: string | null }>
  prs: Array<{ number: number; state: string; createdAt: Date }>
  now: Date
  config: RiskConfig
}): TopBlockers {
  throw new Error('collectTopBlockers not implemented')
}

// Exported helpers used by aggregate workspace risk computation
export function worseLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: Record<RiskLevel, number> = {
    healthy: 0,
    watch: 1,
    'at-risk': 2,
  }
  return order[a] >= order[b] ? a : b
}

export function levelFromScore(score: number): RiskLevel {
  if (score <= RISK_BANDS.HEALTHY_MAX) return 'healthy'
  if (score <= RISK_BANDS.WATCH_MAX) return 'watch'
  return 'at-risk'
}

// Internal utilities (exported so tests can exercise weighted rule list)
export const INTERNAL = { RISK_WEIGHTS, RISK_BANDS }

// Re-exports for convenience
export type { RiskReason, RiskReasonCode, RiskAssessment, TopBlockers }
