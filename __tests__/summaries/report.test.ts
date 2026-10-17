jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mocked-model'),
}))

import {
  SUMMARY_SYSTEM_PROMPT_EN,
  SUMMARY_SYSTEM_PROMPT_ZH,
  SUMMARY_SYSTEM_PROMPT_ZH_HANT,
  buildProjectPrompt,
  summarySystemPrompt,
} from '@/lib/summaries/report'
import { parseReport } from '@/lib/summaries/parse-report'
import type { TaskSummaryStats } from '@/types/summary'

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

describe('system prompts', () => {
  it('ask for a single Today’s Focus section only', () => {
    expect(SUMMARY_SYSTEM_PROMPT_EN).toContain("## Today's Focus")
    expect(SUMMARY_SYSTEM_PROMPT_EN).not.toContain('## Risk')
    expect(SUMMARY_SYSTEM_PROMPT_ZH).toContain('## 今日关注')
    expect(SUMMARY_SYSTEM_PROMPT_ZH).not.toContain('## 风险')
  })
})

describe('summarySystemPrompt (LUM-1117: keyed by defaultLocale)', () => {
  it('writes Simplified Chinese for zh-CN', () => {
    expect(summarySystemPrompt('zh-CN')).toBe(SUMMARY_SYSTEM_PROMPT_ZH)
  })

  it('writes Traditional Chinese for zh-TW (LUM-1121)', () => {
    expect(summarySystemPrompt('zh-TW')).toBe(SUMMARY_SYSTEM_PROMPT_ZH_HANT)
  })

  it.each([['en'], ['en-GB'], ['ja'], ['fr'], ['es-419'], ['']])(
    'falls back to English for %p',
    locale => {
      expect(summarySystemPrompt(locale)).toBe(SUMMARY_SYSTEM_PROMPT_EN)
    }
  )
})

describe('Traditional Chinese prompt (LUM-1121)', () => {
  it('asks for the Traditional focus heading the parser reads', () => {
    expect(SUMMARY_SYSTEM_PROMPT_ZH_HANT).toContain('## 今日焦點')
    expect(SUMMARY_SYSTEM_PROMPT_ZH_HANT).toContain('繁體中文')
    expect(
      parseReport('## 今日焦點\n\n- 審查 PR #42', 'zh-TW').todayFocus
    ).toEqual(['審查 PR #42'])
  })

  it('is written in Traditional characters, not the Simplified prompt', () => {
    expect(SUMMARY_SYSTEM_PROMPT_ZH_HANT).not.toBe(SUMMARY_SYSTEM_PROMPT_ZH)
    // Simplified-only characters (each has a different Traditional form). The
    // first loop proves the list is live against the Simplified prompt, so the
    // second one is a real check rather than a list of absent strings.
    const simplifiedOnly = [
      ...'项负责简报输须严节条动审尽务数优级紧规则坚实统计写题没轻继续进关为会个标头',
    ]
    for (const ch of simplifiedOnly)
      expect(SUMMARY_SYSTEM_PROMPT_ZH).toContain(ch)
    for (const ch of simplifiedOnly)
      expect(SUMMARY_SYSTEM_PROMPT_ZH_HANT).not.toContain(ch)
  })
})
