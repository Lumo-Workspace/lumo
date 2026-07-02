/** @jest-environment jsdom */

// LUM-636 — the by-member expandable rows: collapsed summary + share of
// milestone tokens, expanded delivery detail, and the explicit
// unassigned / unattributed buckets that never merge into a member.

const messages: Record<string, string> = {
  'milestone.memberDelivery.tableTitle': 'By member',
  'milestone.memberDelivery.shareHeader': 'share of {total} tokens',
  'milestone.memberDelivery.doneCount': '{count} done',
  'milestone.memberDelivery.prCount': '{count} PRs',
  'milestone.memberDelivery.done': 'Delivered',
  'milestone.memberDelivery.mergedPrs': 'Merged PRs',
  'milestone.memberDelivery.fateCell':
    '{rejected} rejected · {noRecord} no rejection on record',
  'milestone.memberDelivery.frictionCell':
    '{failRounds} FAIL rounds · {sendBacks} send-backs · {multiPr} multi-PR',
  'milestone.memberDelivery.changedFilesChip': '{count} files changed',
  'milestone.memberDelivery.unassigned': 'Unassigned',
  'milestone.memberDelivery.unattributed': 'Unattributed',
  'milestone.memberDelivery.expandClaims': 'Show delivered claims for {member}',
  'milestone.changeVolume.column': 'Change volume',
  'milestone.changeVolume.memberNone': 'No synced PRs',
  'milestone.outcome.claims.source.AGENT': 'self-reported',
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

import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MilestoneCostTrendSection } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneCostTrendSection'
import type { ApiMilestone } from '@/lib/api-client/milestones'

const deliveryStats = {
  pr: {
    mergedPrCount: 6,
    multiPrTaskCount: 1,
    linkedTaskCount: 5,
    unlinkedTaskCount: 0,
    totalTasks: 6,
  },
  changedFiles: { total: 40, measuredTasks: 5, totalTasks: 6 },
  perMember: {
    measuredTasks: 5,
    tokenCost: 1_000_000,
    activeTimeSec: 7_200,
    rows: [
      {
        memberId: 'mA',
        label: 'Ada',
        tokenCost: 600_000,
        activeTimeSec: 5_400,
        changeVolume: { additions: 900, deletions: 120, measuredPrs: 4 },
      },
      {
        memberId: null,
        label: null,
        tokenCost: 400_000,
        activeTimeSec: 1_800,
      },
    ],
  },
} as unknown as NonNullable<ApiMilestone['deliveryStats']>

const memberDelivery = {
  rows: [
    {
      bucket: 'member',
      memberId: 'mA',
      label: 'Ada',
      taskCount: 4,
      doneCount: 3,
      mergedPrCount: 4,
      fate: { rejectedTaskCount: 0, noRecordDoneCount: 3 },
      friction: { failRoundCount: 1, sendBackCount: 0, multiPrTaskCount: 1 },
      changedFiles: { total: 30, measuredTasks: 4 },
      claims: [
        {
          taskId: 't1',
          ref: 'LUM-1',
          title: 'T1',
          claim: 'delivered the rollup',
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
      friction: { failRoundCount: 0, sendBackCount: 0, multiPrTaskCount: 0 },
      changedFiles: { total: null, measuredTasks: 0 },
      claims: [],
    },
    {
      bucket: 'unattributed',
      memberId: null,
      label: null,
      taskCount: 1,
      doneCount: 1,
      mergedPrCount: 2,
      fate: { rejectedTaskCount: 0, noRecordDoneCount: 1 },
      friction: { failRoundCount: 0, sendBackCount: 0, multiPrTaskCount: 0 },
      changedFiles: { total: null, measuredTasks: 0 },
      claims: [],
    },
  ],
} as unknown as NonNullable<ApiMilestone['memberDelivery']>

test('member rows expand to delivery detail and keep explicit buckets', () => {
  const { container } = render(
    <MilestoneCostTrendSection
      costRollup={undefined}
      burnup={undefined}
      deliveryStats={deliveryStats}
      memberDelivery={memberDelivery}
    />
  )

  // Header states whose total the share percentages refer to.
  expect(screen.getByText('share of 1M tokens')).toBeInTheDocument()

  // Collapsed row: label + spend/delivery summary + share of tokens.
  const adaRow = screen.getByRole('button', {
    name: 'Show delivered claims for Ada',
  })
  expect(adaRow.textContent).toContain('Ada')
  expect(adaRow.textContent).toContain('600K')
  expect(adaRow.textContent).toContain('3 done')
  expect(adaRow.textContent).toContain('4 PRs')
  expect(adaRow.textContent).toContain('60%')

  // Explicit buckets render and never merge into a member row.
  expect(screen.getByText('Unassigned')).toBeInTheDocument()
  expect(screen.getByText('Unattributed')).toBeInTheDocument()
  const rowTexts = [...container.querySelectorAll('li')].map(
    li => li.textContent ?? ''
  )
  expect(rowTexts[0]).toContain('Ada')
  expect(rowTexts[1]).toContain('Unassigned')
  expect(rowTexts[2]).toContain('Unattributed')
  // The spend remainder (member-less sessions) rides the unattributed
  // bucket, not any member.
  expect(rowTexts[2]).toContain('400K')

  // Detail is hidden until expanded.
  expect(screen.queryByText('delivered the rollup')).toBeNull()

  fireEvent.click(adaRow)
  // Expanded: change volume, delivered / merged-PR detail, quality chips,
  // and the frozen claims.
  expect(screen.getByText('+900/−120')).toBeInTheDocument()
  expect(screen.getByText('Delivered')).toBeInTheDocument()
  expect(screen.getByText('3/4')).toBeInTheDocument()
  expect(
    screen.getByText('0 rejected · 3 no rejection on record')
  ).toBeInTheDocument()
  expect(
    screen.getByText('1 FAIL rounds · 0 send-backs · 1 multi-PR')
  ).toBeInTheDocument()
  expect(screen.getByText('30 files changed')).toBeInTheDocument()
  expect(screen.getByText('delivered the rollup')).toBeInTheDocument()
  expect(screen.getByText('self-reported')).toBeInTheDocument()
})
