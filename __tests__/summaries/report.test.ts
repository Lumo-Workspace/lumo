jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mocked-model'),
}))

import {
  SUMMARY_SYSTEM_PROMPT_EN,
  SUMMARY_SYSTEM_PROMPT_ZH,
  buildProjectPrompt,
  buildWorkspacePrompt,
  summarySystemPrompt,
} from '@/lib/summaries/report'
import type { TaskSummaryStats, WorkspaceSummaryStats } from '@/types/summary'

const EMPTY_BLOCKERS = {
  overdueTaskIds: [],
  stalledTaskIds: [],
  failingAgentTaskIds: [],
  staleOpenPrNumbers: [],
  staleOpenPrs: [],
  highStakesTaskIds: [],
}

function makeStats(): TaskSummaryStats {
  return {
    totalTasks: 20,
    statusDistribution: { TODO: 5, IN_PROGRESS: 10, DONE: 5 },
    priorityDistribution: { HIGH: 3 },
    overdueTasks: { count: 7, taskIds: [] },
    memberWorkload: [],
    completionTrend: [],
    avgCompletionTime: 24,
    agentStats: { total: 5, completed: 3, failed: 2, working: 0 },
    prStats: { total: 4, merged: 2, open: 2 },
    topBlockers: EMPTY_BLOCKERS,
  }
}

function makeWorkspaceStats(): WorkspaceSummaryStats {
  return {
    ...makeStats(),
    projectBreakdown: [
      {
        projectId: 'p1',
        projectName: 'Web',
        totalTasks: 20,
        completedTasks: 5,
        overdueTasks: 7,
      },
    ],
  }
}

describe('buildProjectPrompt', () => {
  it('report prompt has no risk assessment block', () => {
    const prompt = buildProjectPrompt(makeStats(), {
      projectName: 'Test',
      projectDescription: null,
      locale: 'en',
    })
    expect(prompt).not.toContain('Risk Assessment')
    expect(prompt).not.toContain('Triggered rules')
    expect(prompt).not.toContain('Level:')
    // The stats the briefing is actually written from still reach the model.
    expect(prompt).toContain('Total Tasks: 20')
    expect(prompt).toContain('Overdue Tasks: 7')
  })
})

describe('buildWorkspacePrompt', () => {
  it('lists projects without a risk level', () => {
    const prompt = buildWorkspacePrompt(makeWorkspaceStats(), {
      workspaceName: 'Lumo',
      locale: 'en',
    })
    expect(prompt).toContain('  Web: total=20, completed=5, overdue=7')
    expect(prompt).not.toContain('Risk Assessment')
  })
})

describe('system prompts', () => {
  it('ask for a single Today’s Focus section only', () => {
    expect(SUMMARY_SYSTEM_PROMPT_EN).toContain("## Today's Focus")
    expect(SUMMARY_SYSTEM_PROMPT_EN).not.toContain('## Risk')
    expect(SUMMARY_SYSTEM_PROMPT_ZH).toContain('## 今日关注')
    expect(SUMMARY_SYSTEM_PROMPT_ZH).not.toContain('## 风险')
  })
})

describe('summarySystemPrompt (LUM-1117: keyed by defaultLocale)', () => {
  it('writes Chinese for the Chinese locales', () => {
    expect(summarySystemPrompt('zh-CN')).toBe(SUMMARY_SYSTEM_PROMPT_ZH)
    expect(summarySystemPrompt('zh-TW')).toBe(SUMMARY_SYSTEM_PROMPT_ZH)
  })

  it.each([['en'], ['en-GB'], ['ja'], ['fr'], ['es-419'], ['']])(
    'falls back to English for %p',
    locale => {
      expect(summarySystemPrompt(locale)).toBe(SUMMARY_SYSTEM_PROMPT_EN)
    }
  )
})
