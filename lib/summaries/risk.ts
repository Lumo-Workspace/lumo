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
  stats: TaskSummaryStats,
  signals: RiskSignals,
  config: RiskConfig
): RiskAssessment {
  const reasons: RiskReason[] = []

  // Rule 1: overdue_ratio_high
  if (stats.totalTasks > 0) {
    const ratio = stats.overdueTasks.count / stats.totalTasks
    if (ratio >= config.overdueRatio) {
      const pct = Math.round(ratio * 100)
      reasons.push({
        code: 'overdue_ratio_high',
        detail: `${stats.overdueTasks.count}/${stats.totalTasks} tasks overdue (${pct}%)`,
      })
    }
  }

  // Rule 2: stalled_tasks
  if (signals.stalledTaskCount >= config.stalledMinCount) {
    reasons.push({
      code: 'stalled_tasks',
      detail: `${signals.stalledTaskCount} tasks with no progress in ${config.stalledDays} days`,
    })
  }

  // Rule 3: agent_failure_rate
  if (stats.agentStats.total >= 3) {
    const failRatio = stats.agentStats.failed / stats.agentStats.total
    if (failRatio >= config.agentFailRatio) {
      const pct = Math.round(failRatio * 100)
      reasons.push({
        code: 'agent_failure_rate',
        detail: `Agent failure rate ${pct}% (${stats.agentStats.failed}/${stats.agentStats.total})`,
      })
    }
  }

  // Rule 4: stale_open_prs
  if (signals.staleOpenPrCount >= 1) {
    reasons.push({
      code: 'stale_open_prs',
      detail: `${signals.staleOpenPrCount} PRs waiting > ${config.stalePrDays} days for review`,
    })
  }

  // Rule 5: throughput_drop
  if (signals.prev7dCompleted > 0) {
    const threshold = signals.prev7dCompleted * config.throughputDrop
    if (signals.last7dCompleted <= threshold) {
      const dropPct = Math.round(
        (1 - signals.last7dCompleted / signals.prev7dCompleted) * 100
      )
      reasons.push({
        code: 'throughput_drop',
        detail: `Completion dropped ${dropPct}% week-over-week`,
      })
    }
  }

  const score = reasons.reduce((sum, r) => sum + RISK_WEIGHTS[r.code], 0)
  return { level: levelFromScore(score), score, reasons }
}

export function collectTopBlockers(input: {
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
  const { tasks, agents, prs, now, config } = input
  const cap = <T>(arr: T[]) => arr.slice(0, 10)

  const stalledCutoff = new Date(
    now.getTime() - config.stalledDays * 24 * 60 * 60 * 1000
  )
  const stalePrCutoff = new Date(
    now.getTime() - config.stalePrDays * 24 * 60 * 60 * 1000
  )

  const overdueTaskIds = cap(
    tasks
      .filter(t => t.dueDate !== null && t.dueDate < now && t.status !== 'DONE')
      .map(t => t.id)
  )

  const stalledTaskIds = cap(
    tasks
      .filter(
        t =>
          t.status !== 'DONE' &&
          t.status !== 'CANCELLED' &&
          t.updatedAt < stalledCutoff
      )
      .map(t => t.id)
  )

  const failingAgentTaskIds = cap(
    agents.filter(a => a.agentStatus === 'FAILED').map(a => a.taskId)
  )

  const staleOpenPrNumbers = cap(
    prs
      .filter(p => p.state === 'open' && p.createdAt < stalePrCutoff)
      .map(p => p.number)
  )

  return {
    overdueTaskIds,
    stalledTaskIds,
    failingAgentTaskIds,
    staleOpenPrNumbers,
  }
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
