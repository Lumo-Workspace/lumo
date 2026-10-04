/** @jest-environment jsdom */

// react-intl ships pure ESM and can't be transformed by jest without special
// config, so mock it the same way other component tests in this project do —
// but read the real en.json so copy assertions (e.g. "No baseline yet")
// resolve to real text.
jest.mock('react-intl', () => {
  const en = require('@/lib/i18n/en.json') as Record<string, string>
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, unknown>
      ) => {
        const template = en[id] ?? defaultMessage ?? id
        if (!values) return template
        return template.replace(/\{(\w+)(?:,[^}]*)?\}/g, (_, key) =>
          values[key] != null ? String(values[key]) : _
        )
      },
    }),
  }
})

import { render, screen } from '@testing-library/react'
import { StatsCardRow } from '@/app/workspace/[workspaceUrl]/components/summary/StatsCardRow'
import type { TaskSummaryStats } from '@/types/summary'

function makeStats(
  overrides: Partial<TaskSummaryStats> = {}
): TaskSummaryStats {
  return {
    totalTasks: 10,
    statusDistribution: { DONE: 6 },
    priorityDistribution: {},
    overdueTasks: { count: 2, taskIds: ['task-1', 'task-2'] },
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
    ...overrides,
  }
}

describe('StatsCardRow', () => {
  it('overdue count shows no-baseline note (honest fallback)', () => {
    render(<StatsCardRow stats={makeStats()} />)

    // the overdue count itself is still visible
    expect(screen.getByText('2')).toBeInTheDocument()
    // honest C-tier fallback caption
    expect(screen.getByText('No baseline yet')).toBeInTheDocument()
  })

  it('other cards are unaffected', () => {
    render(<StatsCardRow stats={makeStats()} />)

    expect(screen.getByText('10')).toBeInTheDocument() // totalTasks
    expect(screen.getByText('6')).toBeInTheDocument() // completed (DONE)
  })
})
