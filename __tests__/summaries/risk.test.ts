import {
  computeRisk,
  DEFAULT_RISK_CONFIG,
  levelFromScore,
  type RiskSignals,
} from '@/lib/summaries/risk'
import type { TaskSummaryStats } from '@/types/summary'

function makeStats(
  overrides: Partial<TaskSummaryStats> = {}
): TaskSummaryStats {
  return {
    totalTasks: 20,
    statusDistribution: {},
    priorityDistribution: {},
    overdueTasks: { count: 0, taskIds: [] },
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
    },
    ...overrides,
  }
}

const emptySignals: RiskSignals = {
  stalledTaskCount: 0,
  staleOpenPrCount: 0,
  last7dCompleted: 0,
  prev7dCompleted: 0,
}

describe('computeRisk', () => {
  it('returns healthy with no reasons when nothing triggers', () => {
    const result = computeRisk(makeStats(), emptySignals, DEFAULT_RISK_CONFIG)
    expect(result.level).toBe('healthy')
    expect(result.score).toBe(0)
    expect(result.reasons).toEqual([])
  })

  it('triggers overdue_ratio_high at exactly the threshold', () => {
    const stats = makeStats({
      totalTasks: 20,
      overdueTasks: { count: 5, taskIds: [] }, // 5/20 = 0.25
    })
    const result = computeRisk(stats, emptySignals, DEFAULT_RISK_CONFIG)
    expect(result.reasons.map(r => r.code)).toContain('overdue_ratio_high')
    expect(result.score).toBe(3)
    expect(result.level).toBe('watch')
  })

  it('does not trigger overdue_ratio_high below threshold', () => {
    const stats = makeStats({
      totalTasks: 20,
      overdueTasks: { count: 4, taskIds: [] }, // 0.20
    })
    const result = computeRisk(stats, emptySignals, DEFAULT_RISK_CONFIG)
    expect(result.reasons.map(r => r.code)).not.toContain('overdue_ratio_high')
  })

  it('guards against totalTasks=0 for overdue_ratio_high', () => {
    const stats = makeStats({
      totalTasks: 0,
      overdueTasks: { count: 0, taskIds: [] },
    })
    const result = computeRisk(stats, emptySignals, DEFAULT_RISK_CONFIG)
    expect(result.level).toBe('healthy')
  })

  it('triggers stalled_tasks when stalledTaskCount >= stalledMinCount', () => {
    const result = computeRisk(
      makeStats(),
      { ...emptySignals, stalledTaskCount: 3 },
      DEFAULT_RISK_CONFIG
    )
    expect(result.reasons.map(r => r.code)).toContain('stalled_tasks')
    expect(result.score).toBe(2)
  })

  it('does not trigger stalled_tasks below stalledMinCount', () => {
    const result = computeRisk(
      makeStats(),
      { ...emptySignals, stalledTaskCount: 2 },
      DEFAULT_RISK_CONFIG
    )
    expect(result.reasons.map(r => r.code)).not.toContain('stalled_tasks')
  })

  it('triggers agent_failure_rate when total >= 3 and failed/total >= ratio', () => {
    const stats = makeStats({
      agentStats: { total: 10, completed: 5, failed: 3, working: 2 }, // 30%
    })
    const result = computeRisk(stats, emptySignals, DEFAULT_RISK_CONFIG)
    expect(result.reasons.map(r => r.code)).toContain('agent_failure_rate')
  })

  it('does not trigger agent_failure_rate when total < 3', () => {
    const stats = makeStats({
      agentStats: { total: 2, completed: 0, failed: 2, working: 0 },
    })
    const result = computeRisk(stats, emptySignals, DEFAULT_RISK_CONFIG)
    expect(result.reasons.map(r => r.code)).not.toContain('agent_failure_rate')
  })

  it('triggers stale_open_prs when staleOpenPrCount >= 1', () => {
    const result = computeRisk(
      makeStats(),
      { ...emptySignals, staleOpenPrCount: 1 },
      DEFAULT_RISK_CONFIG
    )
    expect(result.reasons.map(r => r.code)).toContain('stale_open_prs')
    expect(result.score).toBe(1)
  })

  it('triggers throughput_drop when last7 <= prev7 * throughputDrop', () => {
    const result = computeRisk(
      makeStats(),
      {
        ...emptySignals,
        prev7dCompleted: 10,
        last7dCompleted: 5, // 50% of 10, at threshold
      },
      DEFAULT_RISK_CONFIG
    )
    expect(result.reasons.map(r => r.code)).toContain('throughput_drop')
  })

  it('does not trigger throughput_drop when prev7 is zero', () => {
    const result = computeRisk(
      makeStats(),
      { ...emptySignals, prev7dCompleted: 0, last7dCompleted: 0 },
      DEFAULT_RISK_CONFIG
    )
    expect(result.reasons.map(r => r.code)).not.toContain('throughput_drop')
  })

  it('escalates to at-risk when total score >= 5', () => {
    // overdue (3) + stalled (2) = 5
    const stats = makeStats({
      totalTasks: 20,
      overdueTasks: { count: 10, taskIds: [] },
    })
    const result = computeRisk(
      stats,
      { ...emptySignals, stalledTaskCount: 3 },
      DEFAULT_RISK_CONFIG
    )
    expect(result.score).toBe(5)
    expect(result.level).toBe('at-risk')
  })

  it('detail string cites specific numbers for overdue_ratio_high', () => {
    const stats = makeStats({
      totalTasks: 20,
      overdueTasks: { count: 7, taskIds: [] },
    })
    const result = computeRisk(stats, emptySignals, DEFAULT_RISK_CONFIG)
    const reason = result.reasons.find(r => r.code === 'overdue_ratio_high')
    expect(reason?.detail).toContain('7/20')
    expect(reason?.detail).toContain('35%')
  })
})

describe('levelFromScore', () => {
  it('maps 0,1,2 to healthy', () => {
    expect(levelFromScore(0)).toBe('healthy')
    expect(levelFromScore(2)).toBe('healthy')
  })
  it('maps 3,4 to watch', () => {
    expect(levelFromScore(3)).toBe('watch')
    expect(levelFromScore(4)).toBe('watch')
  })
  it('maps 5+ to at-risk', () => {
    expect(levelFromScore(5)).toBe('at-risk')
    expect(levelFromScore(99)).toBe('at-risk')
  })
})
