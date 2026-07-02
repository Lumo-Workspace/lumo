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
  'milestone.deliveryStats.mergedPrs': 'Merged PRs',
  'milestone.deliveryStats.reworkDetail':
    '{multiPr} tasks took more than one PR · {unlinked} tasks with no PR on record',
  'milestone.deliveryStats.noPrRecords': 'No PRs on record',
  'milestone.deliveryStats.changedFiles': 'Change surface',
  'milestone.deliveryStats.changedFilesNote':
    'Files changed, summed per task — a file shared across tasks is counted per task',
  'milestone.deliveryStats.perMemberTitle': 'Spend by member',
  'milestone.deliveryStats.member': 'Member',
  'milestone.deliveryStats.unattributed': 'Unattributed',
  'milestone.deliveryStats.noSessions': 'No sessions on record',
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
      <MilestoneCostTrendSection
        costRollup={costRollup()}
        burnup={burnup()}
        deliveryStats={undefined}
      />
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
        deliveryStats={undefined}
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
        deliveryStats={undefined}
      />
    )
    expect(
      screen.getByText('No tasks yet — nothing to chart')
    ).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders nothing on an older-server payload with neither field', () => {
    const { container } = render(
      <MilestoneCostTrendSection
        costRollup={undefined}
        burnup={undefined}
        deliveryStats={undefined}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders delivery scale and per-member aggregates', () => {
    const { container } = render(
      <MilestoneCostTrendSection
        costRollup={costRollup()}
        burnup={undefined}
        deliveryStats={{
          pr: {
            mergedPrCount: 12,
            multiPrTaskCount: 3,
            linkedTaskCount: 20,
            unlinkedTaskCount: 6,
            totalTasks: 26,
          },
          changedFiles: { total: 148, measuredTasks: 24, totalTasks: 26 },
          perMember: {
            measuredTasks: 20,
            tokenCost: 1_000_000,
            activeTimeSec: 3660,
            rows: [
              {
                memberId: 'mA',
                label: 'Alice',
                tokenCost: 900_000,
                activeTimeSec: 3600,
              },
              {
                memberId: null,
                label: null,
                tokenCost: 100_000,
                activeTimeSec: 60,
              },
            ],
          },
        }}
      />
    )

    // Delivery-scale cards ride the SAME stat row as the cost aggregates —
    // no new top-level section is introduced.
    expect(
      container.querySelectorAll('section[aria-label="Cost and trajectory"]')
    ).toHaveLength(1)
    expect(container.querySelectorAll('section')).toHaveLength(1)
    expect(screen.getByText('Merged PRs')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    // Risk framing sub-line: multi-PR rework + the explicit unlinked bucket.
    expect(
      screen.getByText(
        '3 tasks took more than one PR · 6 tasks with no PR on record'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Change surface')).toBeInTheDocument()
    expect(screen.getByText('148')).toBeInTheDocument()
    expect(screen.getByText('measured on 24 of 26 tasks')).toBeInTheDocument()
    // Honest double-count label on the summed change surface.
    expect(
      screen.getByText(
        'Files changed, summed per task — a file shared across tasks is counted per task'
      )
    ).toBeInTheDocument()

    // Per-member table: aggregate attribution rows (member + unattributed),
    // never a task list — exactly one row per member in the payload.
    expect(screen.getByText('Spend by member')).toBeInTheDocument()
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect(table!.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('900K')).toBeInTheDocument()
    expect(screen.getByText('1h')).toBeInTheDocument()
    // The unattributed remainder is a real row, rendered last.
    const rows = table!.querySelectorAll('tbody tr')
    expect(rows[1]!.textContent).toContain('Unattributed')
    expect(rows[1]!.textContent).toContain('100K')
  })

  it('renders explicit placeholders for no-PR, unmeasured, and empty member states', () => {
    render(
      <MilestoneCostTrendSection
        costRollup={undefined}
        burnup={undefined}
        deliveryStats={{
          pr: {
            mergedPrCount: 0,
            multiPrTaskCount: 0,
            linkedTaskCount: 0,
            unlinkedTaskCount: 4,
            totalTasks: 4,
          },
          changedFiles: { total: null, measuredTasks: 0, totalTasks: 4 },
          perMember: {
            measuredTasks: 0,
            tokenCost: null,
            activeTimeSec: 0,
            rows: [],
          },
        }}
      />
    )
    // No PR records → an explicit statement, not a fabricated numeric 0.
    expect(screen.getByText('No PRs on record')).toBeInTheDocument()
    // Unmeasured change surface → fail-closed "Not measured".
    expect(screen.getByText('Not measured')).toBeInTheDocument()
    // No sessions at all → explicit empty-member placeholder, no table.
    expect(screen.getByText('No sessions on record')).toBeInTheDocument()
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument()
  })

  it('fail-closes the whole per-member table when nothing is measured', () => {
    const { container } = render(
      <MilestoneCostTrendSection
        costRollup={undefined}
        burnup={undefined}
        deliveryStats={{
          pr: {
            mergedPrCount: 1,
            multiPrTaskCount: 0,
            linkedTaskCount: 1,
            unlinkedTaskCount: 0,
            totalTasks: 1,
          },
          changedFiles: { total: 3, measuredTasks: 1, totalTasks: 1 },
          perMember: {
            measuredTasks: 0,
            tokenCost: null,
            activeTimeSec: 30,
            rows: [
              {
                memberId: 'mA',
                label: 'Alice',
                tokenCost: 0,
                activeTimeSec: 30,
              },
            ],
          },
        }}
      />
    )
    // Zero measured tasks → the table reads "not measured" as a whole
    // instead of a column of fabricated zeros.
    expect(screen.getByText('Spend by member')).toBeInTheDocument()
    expect(screen.getByText('Not measured')).toBeInTheDocument()
    expect(container.querySelector('table')).toBeNull()
  })
})
