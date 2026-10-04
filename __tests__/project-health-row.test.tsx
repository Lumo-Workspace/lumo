/** @jest-environment jsdom */
/**
 * LUM-712: the Project tab's health row. What used to be a page of big metric
 * cards plus three always-open detail sections is now one line of pills, each
 * opening its own detail on demand.
 */

// react-intl ships pure ESM and can't be transformed by jest here, so mock it
// against the real en.json — copy assertions then resolve to shipped text.
jest.mock('react-intl', () => {
  const en = require('@/lib/i18n/en.json') as Record<string, string>
  const format = (
    { id, defaultMessage }: { id: string; defaultMessage?: string },
    values?: Record<string, unknown>
  ) => {
    let msg = en[id] ?? defaultMessage ?? id
    msg = msg.replace(
      /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
      (_m, key, one, other) => {
        const n = Number(values?.[key] ?? 0)
        return (n === 1 ? one : other).replace('#', String(n))
      }
    )
    for (const [k, v] of Object.entries(values ?? {})) {
      msg = msg.split(`{${k}}`).join(String(v))
    }
    return msg
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

import { render, screen, within, fireEvent } from '@testing-library/react'
import { ProjectHealthRow } from '@/app/workspace/[workspaceUrl]/components/signal/ProjectHealthRow'
import { buildSignalView } from '@/lib/summaries/signal-view'
import type { TaskSummaryStats, TopBlockers } from '@/types/summary'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-07-28T00:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString()

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
    agentStats: { total: 0, completed: 0, failed: 0, working: 0 },
    prStats: { total: 0, merged: 0, open: 0 },
    topBlockers: { ...emptyBlockers, ...blockers },
    ...over,
  }
}

const stalledTask = (
  id: string,
  identifier: string,
  title: string,
  days: number,
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' = 'MEDIUM'
) => ({ id, identifier, title, updatedAt: daysAgo(days), priority })

function setup(stats: TaskSummaryStats, onOpenTask = jest.fn()) {
  const view = buildSignalView(stats)
  const utils = render(
    <ProjectHealthRow
      label='Health'
      view={view}
      stalled={stats.topBlockers.stalledTaskIds}
      highStakes={stats.topBlockers.highStakesTaskIds}
      stalePrs={stats.topBlockers.staleOpenPrs}
      now={NOW}
      onOpenTask={onOpenTask}
    />
  )
  return { ...utils, onOpenTask }
}

describe('ProjectHealthRow', () => {
  it('health row expands one detail panel at a time and leaves overdue inert', () => {
    setup(
      makeStats(
        {
          stalledTaskIds: [
            stalledTask('t1', 'LUM-550', 'Project detail overview', 9),
            stalledTask('t2', 'LUM-462', 'MERGED signal dispersion', 19),
          ],
          staleOpenPrs: [
            {
              number: 16,
              openedAt: daysAgo(6),
              url: 'https://github.com/o/r/pull/16',
            },
          ],
        },
        { overdueTasks: { count: 3, taskIds: ['a', 'b', 'c'] } }
      )
    )

    // Nothing is open until asked.
    expect(screen.queryByTestId('signal-panel-stalled')).not.toBeInTheDocument()

    const stalledPill = screen.getByTestId('signal-pill-stalled')
    fireEvent.click(stalledPill)
    expect(screen.getByTestId('signal-panel-stalled')).toBeInTheDocument()
    expect(stalledPill).toHaveAttribute('aria-expanded', 'true')

    // Opening a second signal closes the first — the row stays a summary with
    // at most one problem unfolded under it.
    fireEvent.click(screen.getByTestId('signal-pill-stalePrs'))
    expect(screen.getByTestId('signal-panel-stalePrs')).toBeInTheDocument()
    expect(screen.queryByTestId('signal-panel-stalled')).not.toBeInTheDocument()

    // Clicking the open pill again collapses it.
    fireEvent.click(screen.getByTestId('signal-pill-stalePrs'))
    expect(
      screen.queryByTestId('signal-panel-stalePrs')
    ).not.toBeInTheDocument()

    // Overdue fires, so it gets a pill — but the stats endpoint carries no
    // titles for it, so the pill is not a button and opens nothing.
    const overdue = screen.getByTestId('signal-pill-overdue')
    expect(overdue.tagName).toBe('SPAN')
    fireEvent.click(overdue)
    expect(screen.queryByTestId('signal-panel-overdue')).not.toBeInTheDocument()
  })

  it('gives every firing signal a pill and says nothing at all about the quiet ones', () => {
    setup(
      makeStats({
        stalledTaskIds: [stalledTask('t1', 'LUM-550', 'Stalled', 9)],
      })
    )

    expect(screen.getByTestId('signal-pill-stalled')).toHaveTextContent(
      '1 stalled task'
    )

    // A quiet signal leaves no trace — no pill, and no green check enumerating
    // what is not wrong. A real problem would already be a pill.
    for (const key of ['stalePrs', 'overdue', 'highStakes']) {
      expect(screen.queryByTestId(`signal-pill-${key}`)).not.toBeInTheDocument()
      expect(
        screen.queryByTestId(`signal-clear-${key}`)
      ).not.toBeInTheDocument()
    }
    expect(screen.queryByTestId('signal-all-clear')).not.toBeInTheDocument()

    // The standing completion count is gone with them.
    expect(screen.queryByText(/595 \/ 638 done/)).not.toBeInTheDocument()
  })

  it('collapses to a single all-clear line when no signal fires', () => {
    setup(makeStats())

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByTestId('signal-all-clear')).toHaveTextContent(
      'All clear'
    )
    // One line, not four green checks.
    expect(screen.queryByTestId('signal-clear-stalled')).not.toBeInTheDocument()
  })

  it('tones the stalled pill danger and the stale-PR pill warning', () => {
    // Severity is the pill's whole point. Asserted on the surface classes
    // because the text stays neutral (the accent hues fail AA as body text).
    setup(
      makeStats({
        stalledTaskIds: [stalledTask('t1', 'LUM-550', 'Stalled', 9)],
        staleOpenPrs: [
          {
            number: 16,
            openedAt: daysAgo(6),
            url: 'https://github.com/o/r/pull/16',
          },
        ],
      })
    )

    expect(screen.getByTestId('signal-pill-stalled')).toHaveClass(
      'bg-danger-subtle',
      'border-danger-border'
    )
    expect(screen.getByTestId('signal-pill-stalePrs')).toHaveClass(
      'bg-warning-subtle',
      'border-warning-border'
    )
  })

  it('shows every stalled task in the panel, including ones promoted to high-stakes', () => {
    // The pill says "2 stalled tasks", so the panel must show two rows. Only
    // one panel is open at a time, so a high-stakes task appearing in both its
    // own panel and the stalled one is never visible twice at once.
    setup(
      makeStats({
        highStakesTaskIds: [
          stalledTask('t1', 'LUM-550', 'Promoted', 9, 'URGENT'),
        ],
        stalledTaskIds: [
          stalledTask('t1', 'LUM-550', 'Promoted', 9, 'URGENT'),
          stalledTask('t2', 'LUM-462', 'Only in the table', 19, 'LOW'),
        ],
      })
    )

    expect(screen.getByTestId('signal-pill-stalled')).toHaveTextContent(
      '2 stalled tasks'
    )

    fireEvent.click(screen.getByTestId('signal-pill-stalled'))
    const panel = screen.getByTestId('signal-panel-stalled')
    expect(within(panel).getByText('LUM-550')).toBeInTheDocument()
    expect(within(panel).getByText('LUM-462')).toBeInTheDocument()
    // Each row still leads with a dot coloured from its own --priority-* token.
    expect(within(panel).getByTestId('priority-dot-low')).toHaveClass(
      'text-priority-low'
    )
    expect(within(panel).getByText('19d')).toBeInTheDocument()
  })

  it('each firing pill states the number of rows its own panel shows', () => {
    // The pill number is the only count on the page now that the tab badge is
    // gone, so it has to survive being checked against the panel it opens.
    setup(
      makeStats({
        stalledTaskIds: [
          stalledTask('t1', 'LUM-550', 'One', 9),
          stalledTask('t2', 'LUM-462', 'Two', 19),
          stalledTask('t3', 'LUM-493', 'Three', 44),
        ],
        highStakesTaskIds: [stalledTask('t1', 'LUM-550', 'One', 9, 'URGENT')],
        staleOpenPrs: [
          {
            number: 16,
            openedAt: daysAgo(6),
            url: 'https://github.com/o/r/pull/16',
          },
          {
            number: 17,
            openedAt: daysAgo(8),
            url: 'https://github.com/o/r/pull/17',
          },
        ],
      })
    )

    const rowsIn = (panel: HTMLElement, selector: string) =>
      panel.querySelectorAll(selector).length

    fireEvent.click(screen.getByTestId('signal-pill-stalled'))
    expect(screen.getByTestId('signal-pill-stalled')).toHaveTextContent(
      '3 stalled tasks'
    )
    // Rows only — the trailing "View all" hand-off is not a stalled task.
    const stalledPanel = screen.getByTestId('signal-panel-stalled')
    expect(rowsIn(stalledPanel, 'button')).toBe(3)

    fireEvent.click(screen.getByTestId('signal-pill-highStakes'))
    expect(screen.getByTestId('signal-pill-highStakes')).toHaveTextContent(
      '1 high-stakes stall'
    )
    expect(
      rowsIn(screen.getByTestId('signal-panel-highStakes'), 'button')
    ).toBe(1)

    fireEvent.click(screen.getByTestId('signal-pill-stalePrs'))
    expect(screen.getByTestId('signal-pill-stalePrs')).toHaveTextContent(
      '2 stale PRs'
    )
    expect(rowsIn(screen.getByTestId('signal-panel-stalePrs'), 'a')).toBe(2)
  })

  it('opens a task from a stalled row', () => {
    const { onOpenTask } = setup(
      makeStats({
        stalledTaskIds: [stalledTask('t1', 'LUM-550', 'Stalled', 9)],
      })
    )

    fireEvent.click(screen.getByTestId('signal-pill-stalled'))
    fireEvent.click(screen.getByText('Stalled'))
    expect(onOpenTask).toHaveBeenCalledWith('t1')
  })

  it('links a stale PR straight to GitHub in a new tab', () => {
    setup(
      makeStats({
        staleOpenPrs: [
          {
            number: 16,
            openedAt: daysAgo(6),
            url: 'https://github.com/o/r/pull/16',
          },
        ],
      })
    )

    fireEvent.click(screen.getByTestId('signal-pill-stalePrs'))
    const panel = screen.getByTestId('signal-panel-stalePrs')
    expect(within(panel).getByText('in review 6d')).toBeInTheDocument()

    const link = within(panel).getByRole('link', { name: /#16/ })
    expect(link).toHaveAttribute('href', 'https://github.com/o/r/pull/16')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('offers the Tasks hand-off only when the caller supplies one', () => {
    const stats = makeStats({
      stalledTaskIds: [stalledTask('t1', 'LUM-550', 'Stalled', 9)],
    })
    const view = buildSignalView(stats)

    const { rerender } = render(
      <ProjectHealthRow
        label='Health'
        view={view}
        stalled={stats.topBlockers.stalledTaskIds}
        highStakes={[]}
        stalePrs={[]}
        now={NOW}
        onOpenTask={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('signal-pill-stalled'))
    expect(screen.queryByText(/View all 1 in Tasks/)).not.toBeInTheDocument()

    const onViewAllTasks = jest.fn()
    rerender(
      <ProjectHealthRow
        label='Health'
        view={view}
        stalled={stats.topBlockers.stalledTaskIds}
        highStakes={[]}
        stalePrs={[]}
        now={NOW}
        onOpenTask={jest.fn()}
        onViewAllTasks={onViewAllTasks}
      />
    )
    // The panel is still open across the rerender — the hand-off appears in it.
    fireEvent.click(screen.getByText(/View all 1 in Tasks/))
    expect(onViewAllTasks).toHaveBeenCalled()
  })
})
