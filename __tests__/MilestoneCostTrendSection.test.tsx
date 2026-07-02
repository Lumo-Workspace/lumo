/** @jest-environment jsdom */

const messages: Record<string, string> = {
  'milestone.costTrend.label': 'Cost and trajectory',
  'milestone.costTrend.title': 'Cost & trajectory',
  'milestone.costTrend.tokens': 'Tokens',
  'milestone.costTrend.activeTime': 'Active time',
  'milestone.costTrend.notMeasured': 'Not measured',
  'milestone.costTrend.coverage': 'measured on {measured} of {total} tasks',
  'milestone.costTrend.burnupTitle': 'Burnup across sprints',
  'milestone.costTrend.scope': 'Scope',
  'milestone.costTrend.completed': 'Completed',
  'milestone.costTrend.empty': 'No tasks yet — nothing to chart',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      let msg = messages[id] ?? id
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.replace(`{${k}}`, String(v))
      }
      return msg
    },
  }),
}))

// Recharts' ResponsiveContainer measures its parent (0×0 in jsdom) and renders
// nothing. Replace it with a fixed-size passthrough so the chart mounts and
// produces an <svg> we can assert on.
jest.mock('recharts', () => {
  const Original = jest.requireActual('recharts')
  const React = jest.requireActual('react')
  return {
    ...Original,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 500, height: 300 }),
  }
})

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import {
  MilestoneCostTrendSection,
  buildMilestoneBurnupChart,
} from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneCostTrendSection'
import type { ApiMilestone } from '@/lib/api-client/milestones'

type Burnup = NonNullable<ApiMilestone['burnup']>

const burnup = (overrides: Partial<Burnup> = {}): Burnup => ({
  start: '2026-01-04',
  end: '2026-01-16',
  unit: 'tasks',
  scopeTotal: 2,
  series: [
    { date: '2026-01-04', scope: 1, completed: 0 },
    { date: '2026-01-07', scope: 1, completed: 1 },
    { date: '2026-01-16', scope: 2, completed: 1 },
  ],
  sprintWindows: [
    {
      sprintId: 's1',
      number: 1,
      name: 'Sprint 1',
      start: '2026-01-05',
      end: '2026-01-09',
    },
    {
      sprintId: 's2',
      number: 2,
      name: 'Sprint 2',
      start: '2026-01-12',
      end: '2026-01-20',
    },
  ],
  ...overrides,
})

const costRollup = (
  overrides: Partial<NonNullable<ApiMilestone['costRollup']>> = {}
): NonNullable<ApiMilestone['costRollup']> => ({
  tokenCost: 1_234_000,
  activeTimeSec: 8100,
  measuredTasks: 5,
  totalTasks: 8,
  ...overrides,
})

describe('buildMilestoneBurnupChart', () => {
  it('clamps sprint bands to the series domain and drops out-of-window bands', () => {
    const { bands, maxY, rows } = buildMilestoneBurnupChart(
      burnup({
        sprintWindows: [
          // fully inside
          {
            sprintId: 's1',
            number: 1,
            name: 'Sprint 1',
            start: '2026-01-05',
            end: '2026-01-09',
          },
          // ACTIVE sprint extending past the series end → clamped
          {
            sprintId: 's2',
            number: 2,
            name: 'Sprint 2',
            start: '2026-01-12',
            end: '2026-01-20',
          },
          // entirely after the series → dropped
          {
            sprintId: 's3',
            number: 3,
            name: 'Sprint 3',
            start: '2026-02-01',
            end: '2026-02-05',
          },
        ],
      })
    )
    expect(rows).toHaveLength(3)
    expect(maxY).toBe(2)
    expect(bands).toEqual([
      { sprintId: 's1', name: 'Sprint 1', x1: '2026-01-05', x2: '2026-01-09' },
      { sprintId: 's2', name: 'Sprint 2', x1: '2026-01-12', x2: '2026-01-16' },
    ])
  })
})

describe('MilestoneCostTrendSection', () => {
  it('cost trend section renders aggregates not a task list', () => {
    const { container } = render(
      <MilestoneCostTrendSection costRollup={costRollup()} burnup={burnup()} />
    )

    // Aggregate stat row: compact token total + active time + coverage note.
    expect(screen.getByText('Tokens')).toBeInTheDocument()
    expect(screen.getByText('1.2M')).toBeInTheDocument()
    expect(screen.getByText('Active time')).toBeInTheDocument()
    expect(screen.getByText('2h 15m')).toBeInTheDocument()
    expect(screen.getByText('measured on 5 of 8 tasks')).toBeInTheDocument()

    // Burnup chart mounts (trajectory, not a list) with its legend.
    expect(
      screen.getByRole('heading', { name: /Burnup across sprints/i })
    ).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('Scope')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()

    // No per-task rows: the section renders no list semantics at all.
    expect(container.querySelector('ul, ol, table')).toBeNull()
  })

  it('renders an explicit not-measured token state distinct from 0', () => {
    render(
      <MilestoneCostTrendSection
        costRollup={costRollup({
          tokenCost: null,
          measuredTasks: 0,
          activeTimeSec: 0,
        })}
        burnup={undefined}
      />
    )
    expect(screen.getByText('Not measured')).toBeInTheDocument()
    // The token stat never shows a fabricated numeric 0 (only the active-time
    // stat legitimately reads "0s").
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument()
    expect(screen.getByText('measured on 0 of 8 tasks')).toBeInTheDocument()
  })

  it('renders an explicit empty state instead of a fake chart for a task-less milestone', () => {
    const { container } = render(
      <MilestoneCostTrendSection
        costRollup={costRollup({
          tokenCost: null,
          activeTimeSec: 0,
          measuredTasks: 0,
          totalTasks: 0,
        })}
        burnup={burnup({ scopeTotal: 0, series: [] })}
      />
    )
    expect(
      screen.getByText('No tasks yet — nothing to chart')
    ).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders nothing on an older-server payload with neither field', () => {
    const { container } = render(
      <MilestoneCostTrendSection costRollup={undefined} burnup={undefined} />
    )
    expect(container.firstChild).toBeNull()
  })
})
