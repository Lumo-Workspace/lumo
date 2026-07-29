import {
  buildSignalView,
  signalAttentionCount,
} from '@/lib/summaries/signal-view'
import type { TaskSummaryStats, TopBlockers } from '@/types/summary'

const emptyBlockers: TopBlockers = {
  overdueTaskIds: [],
  stalledTaskIds: [],
  failingAgentTaskIds: [],
  staleOpenPrNumbers: [],
  staleOpenPrs: [],
  highStakesTaskIds: [],
}

const task = (id: string) => ({
  id,
  identifier: `LUM-${id}`,
  title: `Task ${id}`,
  updatedAt: '2026-07-19T00:00:00.000Z',
  priority: 'MEDIUM' as const,
})

function makeStats(
  blockers: Partial<TopBlockers> = {},
  over: Partial<TaskSummaryStats> = {}
): TaskSummaryStats {
  return {
    totalTasks: 10,
    statusDistribution: { DONE: 4 },
    priorityDistribution: {},
    overdueTasks: { count: 0, taskIds: [] },
    memberWorkload: [],
    completionTrend: [],
    avgCompletionTime: null,
    subtaskCompletionRate: null,
    agentStats: { total: 0, completed: 0, failed: 0, working: 0 },
    prStats: { total: 0, merged: 0, open: 0 },
    topBlockers: { ...emptyBlockers, ...blockers },
    ...over,
  }
}

describe('signalAttentionCount', () => {
  it('sums the count of every firing signal', () => {
    const view = buildSignalView(
      makeStats(
        {
          stalledTaskIds: [task('1'), task('2'), task('3')],
          highStakesTaskIds: [task('1')],
          staleOpenPrs: [
            {
              number: 1,
              openedAt: '2026-07-22T00:00:00.000Z',
              url: 'https://x/1',
            },
          ],
        },
        { overdueTasks: { count: 4, taskIds: ['a', 'b', 'c', 'd'] } }
      )
    )

    expect(signalAttentionCount(view)).toBe(3 + 1 + 1 + 4)
  })

  it('is zero when nothing fired, so the badge can be dropped entirely', () => {
    const view = buildSignalView(makeStats())

    expect(view.anomalies).toHaveLength(0)
    expect(signalAttentionCount(view)).toBe(0)
  })

  it('counts only signals that fired — clear notes contribute nothing', () => {
    const view = buildSignalView(
      makeStats({
        staleOpenPrs: [
          {
            number: 7,
            openedAt: '2026-07-20T00:00:00.000Z',
            url: 'https://x/7',
          },
        ],
      })
    )

    expect(view.clear.length).toBeGreaterThan(0)
    expect(signalAttentionCount(view)).toBe(1)
  })
})
