/** @jest-environment jsdom */

// react-intl ships pure ESM and can't be transformed by jest without special
// config, so mock it like the other component tests here — reading the real
// en.json so copy assertions resolve to shipped text.
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
    useIntl: () => ({
      locale: 'en',
      formatMessage: format,
      formatDate: (d: string | Date) =>
        new Date(d).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }),
    }),
  }
})

const mockStats = jest.fn()
const mockReport = jest.fn()

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useRealtimeStats', () => ({
  useProjectRealtimeStats: () => mockStats(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useLatestReport', () => ({
  useProjectLatestReport: () => mockReport(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useReportRefresh', () => ({
  useReportRefresh: () => ({
    state: 'idle',
    cooldownSeconds: 0,
    trigger: jest.fn(),
  }),
}))

import { render, screen, within } from '@testing-library/react'
import { ProjectSignalTab } from '@/app/workspace/[workspaceUrl]/components/signal/ProjectSignalTab'
import type { TaskSummaryStats, TopBlockers } from '@/types/summary'

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString()

const emptyBlockers: TopBlockers = {
  overdueTaskIds: [],
  stalledTaskIds: [],
  failingAgentTaskIds: [],
  staleOpenPrNumbers: [],
  staleOpenPrs: [],
  highStakesTaskIds: [],
}

function makeStats(
  blockers: Partial<TopBlockers> = {},
  over: Partial<TaskSummaryStats> = {}
): TaskSummaryStats {
  return {
    totalTasks: 638,
    statusDistribution: { DONE: 595 },
    priorityDistribution: {},
    overdueTasks: { count: 0, taskIds: [] },
    memberWorkload: [],
    completionTrend: [],
    avgCompletionTime: null,
    subtaskCompletionRate: null,
    agentStats: { total: 0, completed: 0, failed: 0, working: 0 },
    prStats: { total: 0, merged: 0, open: 0 },
    risk: { level: 'watch', score: 40, reasons: [] },
    topBlockers: { ...emptyBlockers, ...blockers },
    ...over,
  }
}

function setup(stats: TaskSummaryStats | null, tldr: string | null = null) {
  mockStats.mockReturnValue({ stats, loading: false, error: null })
  mockReport.mockReturnValue({
    tldr,
    report: null,
    generatedAt: null,
    loading: false,
    refetch: jest.fn(),
  })
  return render(<ProjectSignalTab projectId='p1' />)
}

beforeEach(() => {
  mockStats.mockReset()
  mockReport.mockReset()
})

describe('ProjectSignalTab', () => {
  it('collapses non-firing signals into the all-clear line', () => {
    // Only stalled fires. The other three tracked signals are quiet and must
    // not take up a metric card — they belong on the single green-check row.
    setup(
      makeStats({
        stalledTaskIds: [
          {
            id: 't1',
            identifier: 'LUM-550',
            title: 'PR: project detail overview',
            updatedAt: daysAgo(9),
            priority: 'MEDIUM' as const,
          },
        ],
      })
    )

    const card = screen.getByTestId('signal-card-stalled')
    expect(within(card).getByText('Stalled tasks')).toBeInTheDocument()
    expect(within(card).getByText('1')).toBeInTheDocument()

    // Quiet signals appear as clear notes, never as cards.
    expect(screen.getByTestId('signal-clear-stalePrs')).toBeInTheDocument()
    expect(screen.getByTestId('signal-clear-overdue')).toBeInTheDocument()
    expect(screen.getByTestId('signal-clear-highStakes')).toBeInTheDocument()
    expect(screen.queryByTestId('signal-card-stalePrs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('signal-card-overdue')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('signal-card-highStakes')
    ).not.toBeInTheDocument()

    // The standing completion fact rides along on the same line.
    expect(
      within(screen.getByTestId('signal-clear-completion')).getByText(
        '595 / 638 done'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Everything else is quiet.')).toBeInTheDocument()
  })

  it('renders high-stakes cards, the stalled table and stale PR cards', () => {
    setup(
      makeStats({
        highStakesTaskIds: [
          {
            id: 't1',
            identifier: 'LUM-550',
            title: 'PR: project detail overview',
            updatedAt: daysAgo(9),
            priority: 'MEDIUM' as const,
          },
        ],
        stalledTaskIds: [
          {
            id: 't1',
            identifier: 'LUM-550',
            title: 'PR: project detail overview',
            updatedAt: daysAgo(9),
            priority: 'MEDIUM' as const,
          },
          {
            id: 't2',
            identifier: 'LUM-462',
            title: 'EDA: MERGED signal dispersion',
            updatedAt: daysAgo(19),
            priority: 'MEDIUM' as const,
          },
        ],
        staleOpenPrs: [{ number: 16, openedAt: daysAgo(6) }],
      })
    )

    const highStakes = screen.getByTestId('signal-section-high-stakes')
    expect(within(highStakes).getByText('9d idle')).toBeInTheDocument()

    const stalled = screen.getByTestId('signal-section-stalled')
    // The four designed columns, and a row per stalled task.
    for (const col of ['ID', 'Title', 'Updated', 'Idle']) {
      expect(within(stalled).getByText(col)).toBeInTheDocument()
    }
    expect(within(stalled).getByText('LUM-462')).toBeInTheDocument()
    expect(within(stalled).getByText('19d')).toBeInTheDocument()

    const prs = screen.getByTestId('signal-section-stale-prs')
    expect(within(prs).getByText('#16')).toBeInTheDocument()
    expect(within(prs).getByText('in review 6d')).toBeInTheDocument()
  })

  it('gives each anomaly card a severity stripe in its own tone', () => {
    // Regression guard: the stripe started life as a coloured `border-top`,
    // which rendered as the plain neutral border because this build emits no
    // side-specific border-colour utilities. Severity is the card's whole
    // point, so assert the accent actually lands.
    setup(
      makeStats({
        stalledTaskIds: [
          {
            id: 't1',
            identifier: 'LUM-550',
            title: 'Stalled',
            updatedAt: daysAgo(8),
            priority: 'MEDIUM' as const,
          },
        ],
        staleOpenPrs: [{ number: 16, openedAt: daysAgo(6) }],
      })
    )

    const stripeOf = (key: string) =>
      screen.getByTestId(`signal-card-${key}`).firstElementChild

    expect(stripeOf('stalled')).toHaveClass('bg-danger')
    expect(stripeOf('stalePrs')).toHaveClass('bg-warning')
  })

  it('omits a section entirely when its signal is empty', () => {
    setup(
      makeStats({
        stalledTaskIds: [
          {
            id: 't1',
            identifier: 'LUM-550',
            title: 'Only stalled',
            updatedAt: daysAgo(8),
            priority: 'MEDIUM' as const,
          },
        ],
      })
    )

    expect(screen.getByTestId('signal-section-stalled')).toBeInTheDocument()
    expect(
      screen.queryByTestId('signal-section-high-stakes')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('signal-section-stale-prs')
    ).not.toBeInTheDocument()
  })

  it('leads every stalled row and high-stakes card with its priority dot', () => {
    setup(
      makeStats({
        highStakesTaskIds: [
          {
            id: 't1',
            identifier: 'LUM-550',
            title: 'Urgent one',
            updatedAt: daysAgo(9),
            priority: 'URGENT' as const,
          },
        ],
        stalledTaskIds: [
          {
            id: 't1',
            identifier: 'LUM-550',
            title: 'Urgent one',
            updatedAt: daysAgo(9),
            priority: 'URGENT' as const,
          },
          {
            id: 't2',
            identifier: 'LUM-462',
            title: 'Low one',
            updatedAt: daysAgo(19),
            priority: 'LOW' as const,
          },
        ],
      })
    )

    const table = screen.getByTestId('signal-section-stalled')
    // One dot per row, each coloured from its own --priority-* token.
    expect(within(table).getByTestId('priority-dot-urgent')).toHaveClass(
      'text-priority-urgent'
    )
    expect(within(table).getByTestId('priority-dot-low')).toHaveClass(
      'text-priority-low'
    )

    // The high-stakes card leads with the same dot.
    const cards = screen.getByTestId('signal-section-high-stakes')
    expect(within(cards).getByTestId('priority-dot-urgent')).toBeInTheDocument()

    // The dot carries its label for anyone who can't resolve colour alone.
    expect(within(table).getByTestId('priority-dot-urgent')).toHaveAttribute(
      'aria-label',
      'Urgent'
    )
  })

  it('no longer renders a prose headline above the cards', () => {
    // The design dropped the risk capsule + TL;DR sentence: the cards are the
    // statement. A stray heading here means the old header crept back.
    setup(
      makeStats({
        stalledTaskIds: [
          {
            id: 't1',
            identifier: 'LUM-550',
            title: 'Stalled',
            updatedAt: daysAgo(8),
            priority: 'MEDIUM' as const,
          },
        ],
      }),
      '37 stalled tasks and 3 stale PRs need your attention.'
    )

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        '37 stalled tasks and 3 stale PRs need your attention.'
      )
    ).not.toBeInTheDocument()
  })
})
