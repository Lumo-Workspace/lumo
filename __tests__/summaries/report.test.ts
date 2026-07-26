jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@ai-sdk/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mocked-model'),
}))

import {
  buildProjectPrompt,
  formatReasonsForPrompt,
} from '@/lib/summaries/report'
import type { TaskSummaryStats } from '@/types/summary'

function makeStats(): TaskSummaryStats {
  return {
    totalTasks: 20,
    statusDistribution: { TODO: 5, IN_PROGRESS: 10, DONE: 5 },
    priorityDistribution: { HIGH: 3 },
    overdueTasks: { count: 7, taskIds: [] },
    memberWorkload: [],
    completionTrend: [],
    avgCompletionTime: 24,
    subtaskCompletionRate: null,
    agentStats: { total: 5, completed: 3, failed: 2, working: 0 },
    prStats: { total: 4, merged: 2, open: 2 },
    risk: {
      level: 'watch',
      score: 4,
      reasons: [
        { code: 'overdue_ratio_high', detail: '7/20 tasks overdue (35%)' },
        { code: 'stalled_tasks', detail: '3 tasks with no progress in 7 days' },
      ],
    },
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

describe('formatReasonsForPrompt', () => {
  it('returns "(no triggered rules)" for empty in English', () => {
    expect(formatReasonsForPrompt([], 'en')).toBe('(no triggered rules)')
  })
  it('returns Chinese fallback when locale starts with zh', () => {
    expect(formatReasonsForPrompt([], 'zh')).toBe('(无触发规则)')
  })
  it('formats each reason on its own indented line', () => {
    const out = formatReasonsForPrompt(
      [{ code: 'stalled_tasks', detail: '3 tasks stuck' }],
      'en'
    )
    expect(out).toBe('  - [stalled_tasks] 3 tasks stuck')
  })
})

describe('buildProjectPrompt', () => {
  it('includes Risk Assessment section with level, score, and reasons', () => {
    const prompt = buildProjectPrompt(makeStats(), {
      projectName: 'Test',
      projectDescription: null,
      locale: 'en',
    })
    expect(prompt).toContain('Risk Assessment (pre-computed)')
    expect(prompt).toContain('Level: watch')
    expect(prompt).toContain('Score: 4')
    expect(prompt).toContain('[overdue_ratio_high]')
    expect(prompt).toContain('7/20 tasks overdue (35%)')
  })
})
