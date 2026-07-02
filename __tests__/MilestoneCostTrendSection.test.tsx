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
  'milestone.memberDelivery.tableTitle': 'By member',
  'milestone.memberDelivery.attributionNote':
    "Cost is attributed to the session spender; delivery to the task assignee — an agent's delivery is credited to its owner, or, for a shared agent, to the member who spent the most tokens on the task.",
  'milestone.memberDelivery.done': 'Done tasks',
  'milestone.memberDelivery.mergedPrs': 'Merged PRs',
  'milestone.memberDelivery.fate': 'Post-delivery fate',
  'milestone.memberDelivery.fateCell':
    '{rejected} rejected · {noRecord} no rejection on record',
  'milestone.memberDelivery.friction': 'Acceptance friction',
  'milestone.memberDelivery.frictionCell':
    '{failRounds} FAIL rounds · {sendBacks} send-backs · {multiPr} multi-PR',
  'milestone.memberDelivery.changedFiles': 'Change surface',
  'milestone.memberDelivery.measuredOf': '{measured}/{total} measured',
  'milestone.memberDelivery.unassigned': 'Unassigned',
  'milestone.memberDelivery.unattributed': 'Unattributed',
  'milestone.memberDelivery.expandClaims': 'Show delivered claims for {member}',
  'milestone.memberDelivery.empty': 'No tasks yet',
  'milestone.outcome.claims.noClaim': 'No recorded claim for this delivery',
  'milestone.outcome.claims.source.AGENT': 'self-reported',
  'milestone.changeVolume.title': 'Change volume',
  'milestone.changeVolume.coverage':
    'synced on {measured} of {total} merged PRs',
  'milestone.changeVolume.notSynced': 'Not synced',
  'milestone.changeVolume.note':
    'Lines added/removed across merged PRs — read as change exposure and review load, not output',
  'milestone.changeVolume.column': 'Change volume',
  'milestone.changeVolume.memberNone': 'No synced PRs',
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
import { fireEvent, render, screen } from '@testing-library/react'
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
        memberDelivery={undefined}
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
        memberDelivery={undefined}
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
        memberDelivery={undefined}
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
        memberDelivery={undefined}
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
        memberDelivery={undefined}
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
        memberDelivery={undefined}
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

  it('renders member delivery columns without ratios', () => {
    const memberDelivery: NonNullable<ApiMilestone['memberDelivery']> = {
      rows: [
        // Fixed NAME order from the payload: Alice first even though Bob
        // out-delivers and out-spends her — never a leaderboard.
        {
          bucket: 'member',
          memberId: 'mA',
          label: 'Alice',
          taskCount: 2,
          doneCount: 1,
          mergedPrCount: 1,
          fate: { rejectedTaskCount: 1, noRecordDoneCount: 0 },
          friction: {
            failRoundCount: 2,
            sendBackCount: 1,
            multiPrTaskCount: 1,
          },
          changedFiles: { total: 12, measuredTasks: 1 },
          claims: [
            {
              taskId: 't1',
              ref: 'LUM-1',
              title: 'T1',
              claim: 'shipped the rollup',
              source: 'AGENT',
            },
            {
              taskId: 't2',
              ref: 'LUM-2',
              title: 'T2',
              claim: null,
              source: null,
            },
          ],
        },
        {
          bucket: 'member',
          memberId: 'mB',
          label: 'Bob',
          taskCount: 6,
          doneCount: 5,
          mergedPrCount: 9,
          fate: { rejectedTaskCount: 0, noRecordDoneCount: 5 },
          friction: {
            failRoundCount: 0,
            sendBackCount: 0,
            multiPrTaskCount: 0,
          },
          changedFiles: { total: 80, measuredTasks: 6 },
          claims: [
            {
              taskId: 't3',
              ref: 'LUM-3',
              title: 'T3',
              claim: 'big delivery',
              source: 'AGENT',
            },
          ],
        },
        {
          bucket: 'unassigned',
          memberId: null,
          label: null,
          taskCount: 1,
          doneCount: 0,
          mergedPrCount: 0,
          fate: { rejectedTaskCount: 0, noRecordDoneCount: 0 },
          friction: {
            failRoundCount: 0,
            sendBackCount: 0,
            multiPrTaskCount: 0,
          },
          changedFiles: { total: null, measuredTasks: 0 },
          claims: [],
        },
      ],
    }
    const { container } = render(
      <MilestoneCostTrendSection
        costRollup={undefined}
        burnup={undefined}
        deliveryStats={{
          pr: {
            mergedPrCount: 10,
            multiPrTaskCount: 1,
            linkedTaskCount: 8,
            unlinkedTaskCount: 1,
            totalTasks: 9,
          },
          changedFiles: { total: 92, measuredTasks: 7, totalTasks: 9 },
          perMember: {
            measuredTasks: 8,
            tokenCost: 1_000_000,
            activeTimeSec: 3660,
            // Spend rows arrive volume-sorted (Bob first) — the merged
            // member table must still render by NAME.
            rows: [
              {
                memberId: 'mB',
                label: 'Bob',
                tokenCost: 900_000,
                activeTimeSec: 3600,
              },
              {
                memberId: 'mA',
                label: 'Alice',
                tokenCost: 100_000,
                activeTimeSec: 60,
              },
            ],
          },
        }}
        memberDelivery={memberDelivery}
      />
    )

    // The delivery column group rides the SAME per-member table as the spend
    // columns — quantity and quality inseparable, one row per member.
    expect(screen.getByText('By member')).toBeInTheDocument()
    expect(screen.getByText('Done tasks')).toBeInTheDocument()
    expect(screen.getByText('Post-delivery fate')).toBeInTheDocument()
    expect(screen.getByText('Acceptance friction')).toBeInTheDocument()
    // Appears on the LUM-632 scale card AND as a member-table column header.
    expect(screen.getAllByText('Change surface').length).toBeGreaterThan(1)
    // Both attribution 口径 are stated where the numbers are read.
    expect(
      screen.getAllByText(/Cost is attributed to the session spender/).length
    ).toBeGreaterThan(0)

    // Counts only — no ratio or percentage anywhere in the section.
    expect(container.textContent).not.toMatch(/%/)
    expect(container.textContent).not.toMatch(/\brate\b/i)

    // Fixed member-name order (Alice before Bob) despite Bob's larger spend
    // and delivery volume; the unassigned bucket renders last, explicitly.
    const rowTexts = [...container.querySelectorAll('tbody tr')].map(
      tr => tr.textContent ?? ''
    )
    expect(rowTexts[0]).toContain('Alice')
    expect(rowTexts[1]).toContain('Bob')
    expect(rowTexts[2]).toContain('Unassigned')
    // Quantity and quality cells share Alice's single row.
    expect(rowTexts[0]).toContain('1 rejected · 0 no rejection on record')
    expect(rowTexts[0]).toContain('2 FAIL rounds · 1 send-backs · 1 multi-PR')

    // Claim expansion: the member row opens inline to the frozen claims,
    // including the explicit no-claim row and the source 标注.
    fireEvent.click(
      screen.getByRole('button', { name: 'Show delivered claims for Alice' })
    )
    expect(screen.getByText('shipped the rollup')).toBeInTheDocument()
    expect(screen.getByText('self-reported')).toBeInTheDocument()
    expect(
      screen.getByText('No recorded claim for this delivery')
    ).toBeInTheDocument()
  })

  it('renders change volume as audit columns', () => {
    const { container } = render(
      <MilestoneCostTrendSection
        costRollup={undefined}
        burnup={undefined}
        deliveryStats={{
          pr: {
            mergedPrCount: 3,
            multiPrTaskCount: 0,
            linkedTaskCount: 3,
            unlinkedTaskCount: 0,
            totalTasks: 3,
          },
          changedFiles: { total: 10, measuredTasks: 3, totalTasks: 3 },
          changeVolume: {
            additions: 1200,
            deletions: 340,
            changedFiles: 9,
            measuredPrs: 2,
            totalMergedPrs: 3,
          },
          perMember: {
            measuredTasks: 3,
            tokenCost: 500_000,
            activeTimeSec: 600,
            rows: [
              {
                memberId: 'mA',
                label: 'Alice',
                tokenCost: 500_000,
                activeTimeSec: 600,
                changeVolume: {
                  additions: 1200,
                  deletions: 340,
                  measuredPrs: 2,
                },
              },
              {
                memberId: 'mB',
                label: 'Bob',
                tokenCost: 0,
                activeTimeSec: 0,
                changeVolume: null,
              },
            ],
          },
        }}
        memberDelivery={undefined}
      />
    )

    // Summary card: compact +adds/−dels in the delivery-scale stat row —
    // token-compact notation, tabular numerals. The same compact reading
    // appears exactly twice: the summary card and Alice's table cell.
    expect(screen.getAllByText('Change volume').length).toBeGreaterThan(0)
    const volumes = screen.getAllByText('+1.2K/−340')
    expect(volumes).toHaveLength(2)
    const card = volumes.find(el => el.closest('dd') !== null)!
    expect(card.closest('dd')).toHaveClass('tabular-nums')
    // Honest coverage: the unsynced third PR reads as a gap, never as 0.
    expect(screen.getByText('synced on 2 of 3 merged PRs')).toBeInTheDocument()
    // Audit framing: exposure / review load, explicitly NOT output.
    expect(
      screen.getByText(
        'Lines added/removed across merged PRs — read as change exposure and review load, not output'
      )
    ).toBeInTheDocument()

    // Per-member column: header + per-row compact volume, tabular-nums.
    const table = container.querySelector('table')!
    const headers = [...table.querySelectorAll('thead th')].map(
      th => th.textContent
    )
    expect(headers).toContain('Change volume')
    const aliceRow = [...table.querySelectorAll('tbody tr')].find(tr =>
      tr.textContent?.includes('Alice')
    )!
    expect(aliceRow.textContent).toContain('+1.2K/−340')
    const volumeCell = [...aliceRow.querySelectorAll('td')].find(td =>
      td.textContent?.includes('+1.2K/−340')
    )!
    expect(volumeCell).toHaveClass('tabular-nums')
    // A member with nothing measured reads an explicit state — never +0/−0.
    const bobRow = [...table.querySelectorAll('tbody tr')].find(tr =>
      tr.textContent?.includes('Bob')
    )!
    expect(bobRow.textContent).toContain('No synced PRs')
    expect(bobRow.textContent).not.toContain('+0')
  })

  it('renders the not-synced state for an unsynced milestone — never +0/−0', () => {
    render(
      <MilestoneCostTrendSection
        costRollup={undefined}
        burnup={undefined}
        deliveryStats={{
          pr: {
            mergedPrCount: 2,
            multiPrTaskCount: 0,
            linkedTaskCount: 2,
            unlinkedTaskCount: 0,
            totalTasks: 2,
          },
          changedFiles: { total: 5, measuredTasks: 2, totalTasks: 2 },
          // Old milestone, nothing backfilled: totals are null with honest
          // coverage — the card must read "Not synced", not 0.
          changeVolume: {
            additions: null,
            deletions: null,
            changedFiles: null,
            measuredPrs: 0,
            totalMergedPrs: 2,
          },
          perMember: {
            measuredTasks: 0,
            tokenCost: null,
            activeTimeSec: 0,
            rows: [],
          },
        }}
        memberDelivery={undefined}
      />
    )
    expect(screen.getByText('Not synced')).toBeInTheDocument()
    expect(screen.getByText('synced on 0 of 2 merged PRs')).toBeInTheDocument()
    expect(screen.queryByText(/\+0/)).not.toBeInTheDocument()
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
        memberDelivery={undefined}
      />
    )
    // Zero measured tasks → the table reads "not measured" as a whole
    // instead of a column of fabricated zeros.
    expect(screen.getByText('Spend by member')).toBeInTheDocument()
    expect(screen.getByText('Not measured')).toBeInTheDocument()
    expect(container.querySelector('table')).toBeNull()
  })
})
