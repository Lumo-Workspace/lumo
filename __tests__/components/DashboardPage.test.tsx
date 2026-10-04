/** @jest-environment jsdom */

/**
 * Invariant guard for LUM-699. The project Signal tab dropped the charts,
 * StatsCardRow and SummaryHistory — but those components are shared with the
 * workspace Dashboard, which must keep rendering them. This asserts the shared
 * surface is still intact, so a future "the project page doesn't use it,
 * delete it" cleanup fails loudly here instead of silently gutting Dashboard.
 */

jest.mock('react-intl', () => {
  const en = require('@/lib/i18n/en.json') as Record<string, string>
  const format = (
    { id, defaultMessage }: { id: string; defaultMessage?: string },
    values?: Record<string, unknown>
  ) => {
    const template = en[id] ?? defaultMessage ?? id
    if (!values) return template
    return template.replace(/\{(\w+)(?:,[^}]*)?\}/g, (m, key) =>
      values[key] != null ? String(values[key]) : m
    )
  }
  return {
    useIntl: () => ({ locale: 'en', formatMessage: format }),
    FormattedMessage: ({ id }: { id: string }) => format({ id }),
  }
})

// Recharts' ResponsiveContainer measures its parent (0×0 in jsdom) and renders
// nothing — replace with a fixed-size passthrough so the charts mount.
jest.mock('recharts', () => {
  const Original = jest.requireActual('recharts')
  const React = jest.requireActual('react')
  return {
    ...Original,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 500, height: 300 }),
  }
})

const mockStats = jest.fn()

// LUM-819: the spot-check card's data hook — faked like the other hooks here.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useRunReviewPool', () => ({
  useRunReviewPool: () => ({
    pool: {
      sample: [],
      poolSize: 7,
      rate: { status: 'insufficient', reviewed: 2, rejected: 1, minSample: 10 },
    },
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useRealtimeStats', () => ({
  useWorkspaceRealtimeStats: () => mockStats(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useLatestReport', () => ({
  useWorkspaceLatestReport: () => ({
    tldr: 'Workspace is healthy.',
    report: '',
    generatedAt: '2026-07-24T12:00:00.000Z',
    loading: false,
    refetch: jest.fn(),
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useReportRefresh', () => ({
  useReportRefresh: () => ({
    state: 'idle',
    cooldownSeconds: 0,
    trigger: jest.fn(),
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSummary', () => ({
  useWorkspaceSummary: () => ({
    history: [],
    loadHistory: jest.fn(),
    historyLoading: false,
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMembers', () => ({
  useMembers: () => ({ members: [], agentActors: [] }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: () => null,
}))

import { render, screen } from '@testing-library/react'
import { DashboardPage } from '@/app/workspace/[workspaceUrl]/components/pages/DashboardPage'
import type { WorkspaceSummaryStats } from '@/types/summary'

const stats: WorkspaceSummaryStats = {
  totalTasks: 20,
  statusDistribution: { DONE: 12, IN_PROGRESS: 8 },
  priorityDistribution: { HIGH: 5 },
  overdueTasks: { count: 1, taskIds: ['t1'] },
  memberWorkload: [
    { actorId: 'a1', name: 'Chao Li', assigned: 8, completed: 5 },
  ],
  completionTrend: [
    { date: '2026-07-20', completed: 2 },
    { date: '2026-07-21', completed: 3 },
  ],
  avgCompletionTime: 12.5,
  agentStats: { total: 2, completed: 1, failed: 0, working: 1 },
  prStats: { total: 4, merged: 3, open: 1 },
  topBlockers: {
    overdueTaskIds: [],
    stalledTaskIds: [],
    failingAgentTaskIds: [],
    staleOpenPrNumbers: [],
    staleOpenPrs: [],
    highStakesTaskIds: [],
  },
  projectBreakdown: [],
}

describe('DashboardPage (shared-surface invariant)', () => {
  it('still renders the charts, stats row and summary history', () => {
    mockStats.mockReturnValue({ stats, loading: false, error: null })
    render(
      <DashboardPage
        onNavigateToProject={jest.fn()}
        onOpenRunReviews={jest.fn()}
      />
    )

    const en = require('@/lib/i18n/en.json') as Record<string, string>
    // Resolve through a guard so a renamed key fails loudly instead of
    // turning the assertion into a vacuous undefined lookup.
    const copy = (key: string): string => {
      const value = en[key]
      if (!value) throw new Error(`missing i18n key: ${key}`)
      return value
    }

    // The three charts the project page dropped.
    expect(
      screen.getByText(copy('summary.statusDistribution'))
    ).toBeInTheDocument()
    expect(screen.getByText(copy('summary.memberWorkload'))).toBeInTheDocument()
    expect(
      screen.getByText(copy('summary.completionTrend'))
    ).toBeInTheDocument()

    // StatsCardRow — the total-tasks tile still carries its number.
    expect(screen.getByText('20')).toBeInTheDocument()

    // SummaryHistory's section is still mounted (its history toggle).
    expect(
      screen.getByText(new RegExp(copy('summary.viewHistory')))
    ).toBeInTheDocument()
  })
})
