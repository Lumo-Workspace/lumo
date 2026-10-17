import type { TaskSummaryStats, ApiProjectSummary } from '@/types/summary'

// ─── Type-level tests: verify that the types are well-formed ─────────────────

describe('TaskSummaryStats', () => {
  it('accepts a complete stats object', () => {
    const stats: TaskSummaryStats = {
      totalTasks: 10,
      statusDistribution: { TODO: 3, IN_PROGRESS: 2, IN_REVIEW: 1, DONE: 4 },
      priorityDistribution: { HIGH: 3, MEDIUM: 4, LOW: 3 },
      overdueTasks: { count: 1, taskIds: ['task-1'] },
      memberWorkload: [
        { actorId: 'actor-1', name: 'Alice', assigned: 5, completed: 4 },
      ],
      completionTrend: [{ date: '2026-04-01', completed: 2 }],
      avgCompletionTime: 8,
      agentStats: { total: 2, completed: 1, failed: 0, working: 1 },
      prStats: { total: 3, merged: 2, open: 1 },
      topBlockers: {
        overdueTaskIds: [],
        stalledTaskIds: [],
        failingAgentTaskIds: [],
        staleOpenPrNumbers: [],
        staleOpenPrs: [],
        highStakesTaskIds: [],
      },
    }
    expect(stats.totalTasks).toBe(10)
    expect(stats.overdueTasks.count).toBe(1)
    expect(stats.agentStats.total).toBe(2)
  })

  it('accepts null for optional numeric fields', () => {
    const stats: TaskSummaryStats = {
      totalTasks: 0,
      statusDistribution: {},
      priorityDistribution: {},
      overdueTasks: { count: 0, taskIds: [] },
      memberWorkload: [],
      completionTrend: [],
      avgCompletionTime: null,
      agentStats: { total: 0, completed: 0, failed: 0, working: 0 },
      prStats: { total: 0, merged: 0, open: 0 },
      topBlockers: {
        overdueTaskIds: [],
        stalledTaskIds: [],
        failingAgentTaskIds: [],
        staleOpenPrNumbers: [],
        staleOpenPrs: [],
        highStakesTaskIds: [],
      },
    }
    expect(stats.avgCompletionTime).toBeNull()
  })
})

describe('ApiProjectSummary', () => {
  it('has required fields', () => {
    const summary: ApiProjectSummary = {
      id: 'sum-1',
      projectId: 'proj-1',
      tldr: 'Short summary',
      report: 'Full detailed report',
      generatedAt: '2026-04-07T00:00:00.000Z',
      stats: {
        totalTasks: 5,
        statusDistribution: { DONE: 5 },
        priorityDistribution: {},
        overdueTasks: { count: 0, taskIds: [] },
        memberWorkload: [],
        completionTrend: [],
        avgCompletionTime: null,
        agentStats: { total: 0, completed: 0, failed: 0, working: 0 },
        prStats: { total: 0, merged: 0, open: 0 },
        topBlockers: {
          overdueTaskIds: [],
          stalledTaskIds: [],
          failingAgentTaskIds: [],
          staleOpenPrNumbers: [],
          staleOpenPrs: [],
          highStakesTaskIds: [],
        },
      },
    }
    expect(summary.projectId).toBe('proj-1')
    expect(summary.tldr).toBe('Short summary')
  })
})
