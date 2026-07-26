import {
  computeRisk,
  DEFAULT_RISK_CONFIG,
  type RiskConfig,
  type RiskSignals,
} from '@/lib/summaries/risk'
import type { TaskSummaryStats } from '@/types/summary'

function statsWithOverdue(total: number, overdue: number): TaskSummaryStats {
  return {
    totalTasks: total,
    statusDistribution: {},
    priorityDistribution: {},
    overdueTasks: { count: overdue, taskIds: [] },
    memberWorkload: [],
    completionTrend: [],
    avgCompletionTime: null,
    subtaskCompletionRate: null,
    agentStats: { total: 0, completed: 0, failed: 0, working: 0 },
    prStats: { total: 0, merged: 0, open: 0 },
    risk: { level: 'healthy', score: 0, reasons: [] },
    topBlockers: {
      overdueTaskIds: [],
      stalledTaskIds: [],
      failingAgentTaskIds: [],
      staleOpenPrNumbers: [],
      staleOpenPrs: [],
      highStakesTaskIds: [],
    },
  }
}

const emptySignals: RiskSignals = {
  stalledTaskCount: 0,
  staleOpenPrCount: 0,
  last7dCompleted: 0,
  prev7dCompleted: 0,
}

describe('computeRisk with custom config', () => {
  it('same stats become healthy under lenient overdueRatio', () => {
    const stats = statsWithOverdue(20, 5) // 25%
    const lenient: RiskConfig = { ...DEFAULT_RISK_CONFIG, overdueRatio: 0.5 }
    expect(computeRisk(stats, emptySignals, lenient).level).toBe('healthy')
  })

  it('same stats become watch under strict overdueRatio', () => {
    const stats = statsWithOverdue(20, 3) // 15%
    const strict: RiskConfig = { ...DEFAULT_RISK_CONFIG, overdueRatio: 0.1 }
    expect(computeRisk(stats, emptySignals, strict).level).toBe('watch')
  })

  it('stalledMinCount override changes whether rule triggers', () => {
    const lax: RiskConfig = { ...DEFAULT_RISK_CONFIG, stalledMinCount: 10 }
    const result = computeRisk(
      statsWithOverdue(20, 0),
      { ...emptySignals, stalledTaskCount: 5 },
      lax
    )
    expect(result.reasons.map(r => r.code)).not.toContain('stalled_tasks')
  })

  it('custom throughputDrop changes when rule triggers', () => {
    const strict: RiskConfig = { ...DEFAULT_RISK_CONFIG, throughputDrop: 0.9 }
    // last7=8, prev7=10, ratio=0.8, strict threshold=0.9 → triggers
    const result = computeRisk(
      statsWithOverdue(20, 0),
      { ...emptySignals, prev7dCompleted: 10, last7dCompleted: 8 },
      strict
    )
    expect(result.reasons.map(r => r.code)).toContain('throughput_drop')
  })
})
