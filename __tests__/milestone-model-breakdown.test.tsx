/** @jest-environment jsdom */

// LUM-636 — per-model token breakdown on the milestone Overview: the Tokens
// KPI card and the expanded member rows split the measured spend by model
// (Session.usageByModel), with top-N folding, an explicit unattributed
// remainder, and NO bars when the payload carries no model data.

const messages: Record<string, string> = {
  'milestone.costTrend.tokens': 'Tokens',
  'milestone.costTrend.coverage': 'measured on {measured} of {total} tasks',
  'milestone.costTrend.moreModels': '{count} more models · {total}',
  'milestone.costTrend.modelUnattributed': '{total} not attributed to a model',
  'tokenCost.output': 'output',
  'tokenCost.input': 'input',
  'tokenCost.cacheCreate': 'cache-create',
  'tokenCost.cacheRead': 'cache-read',
  'milestone.memberDelivery.expandClaims': 'Show delivered claims for {member}',
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

beforeAll(() => {
  // jsdom has no ResizeObserver; Radix tooltip content uses it for sizing.
  if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MilestoneCostTrendSection } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneCostTrendSection'
import type { ApiMilestone } from '@/lib/api-client/milestones'

const model = (model: string, output: number) => ({
  model,
  input: 10,
  output,
  cacheRead: 5,
  cacheCreation: 5,
  total: 20 + output,
})

const costRollup = {
  tokenCost: 1_000_000,
  activeTimeSec: 60,
  measuredTasks: 4,
  totalTasks: 4,
  // 4 models: top 3 render as rows, the 4th folds into the more-models line.
  models: [
    model('claude-opus-4-5', 400),
    model('claude-sonnet-4-5', 300),
    model('claude-haiku-4-5', 200),
    model('claude-3-5-haiku', 100),
  ],
  modelUnattributedTokens: 5_000,
} as NonNullable<ApiMilestone['costRollup']>

const deliveryStats = {
  pr: {
    mergedPrCount: 1,
    multiPrTaskCount: 0,
    linkedTaskCount: 1,
    unlinkedTaskCount: 0,
    totalTasks: 1,
  },
  changedFiles: { total: 3, measuredTasks: 1, totalTasks: 1 },
  perMember: {
    measuredTasks: 4,
    tokenCost: 1_000_000,
    activeTimeSec: 60,
    rows: [
      {
        memberId: 'mA',
        label: 'Ada',
        tokenCost: 600_000,
        activeTimeSec: 60,
        models: [model('member-model-opus', 50)],
        modelUnattributedTokens: 0,
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
      taskCount: 1,
      doneCount: 1,
      mergedPrCount: 1,
      fate: { rejectedTaskCount: 0, noRecordDoneCount: 1 },
      friction: { failRoundCount: 0, sendBackCount: 0, multiPrTaskCount: 0 },
      changedFiles: { total: 3, measuredTasks: 1 },
      claims: [],
    },
  ],
} as unknown as NonNullable<ApiMilestone['memberDelivery']>

test('tokens KPI and member rows render per-model token breakdown honestly', () => {
  render(
    <MilestoneCostTrendSection
      costRollup={costRollup}
      burnup={undefined}
      deliveryStats={deliveryStats}
      memberDelivery={memberDelivery}
    />
  )

  // Top 3 model rows render with their totals; the 4th folds.
  expect(screen.getByText('claude-opus-4-5')).toBeInTheDocument()
  expect(screen.getByText('claude-sonnet-4-5')).toBeInTheDocument()
  expect(screen.getByText('claude-haiku-4-5')).toBeInTheDocument()
  expect(screen.queryByText('claude-3-5-haiku')).toBeNull()
  expect(screen.getByText('1 more models · 120')).toBeInTheDocument()

  // Spend not attributable to a model is an explicit line, never folded in.
  expect(screen.getByText('5K not attributed to a model')).toBeInTheDocument()

  // The four-kind legend labels the segment encoding once, on the KPI card.
  expect(screen.getByText('output')).toBeInTheDocument()
  expect(screen.getByText('input')).toBeInTheDocument()
  expect(screen.getByText('cache-create')).toBeInTheDocument()
  expect(screen.getByText('cache-read')).toBeInTheDocument()

  // Each rendered model row carries a segment bar.
  expect(screen.getAllByTestId('model-usage-row')).toHaveLength(3)

  // The member's split is hidden until the row expands.
  expect(screen.queryByText('member-model-opus')).toBeNull()
  fireEvent.click(
    screen.getByRole('button', { name: 'Show delivered claims for Ada' })
  )
  expect(screen.getByText('member-model-opus')).toBeInTheDocument()
  expect(screen.getAllByTestId('model-usage-row')).toHaveLength(4)
})

test('hovering a model bar opens a tooltip with the four exact counts', async () => {
  render(
    <MilestoneCostTrendSection
      costRollup={{
        tokenCost: 1_000_000,
        activeTimeSec: 60,
        measuredTasks: 1,
        totalTasks: 1,
        models: [
          {
            model: 'claude-opus-4-5',
            input: 22_158_326,
            output: 14_772_410,
            cacheRead: 174_800_732,
            cacheCreation: 34_468_532,
            total: 246_200_000,
          },
        ],
        modelUnattributedTokens: 0,
      }}
      burnup={undefined}
      deliveryStats={undefined}
      memberDelivery={undefined}
    />
  )

  // Rows read compact; the exact ungrouped numbers appear only on demand.
  // jsdom can't drive Radix's pointer-hover path — focus opens the same
  // tooltip (the bar is keyboard-focusable for exactly this reason).
  expect(screen.queryByText('14,772,410')).toBeNull()
  fireEvent.focus(screen.getByTestId('model-usage-bar'))
  // Radix mounts the content plus a visually-hidden a11y duplicate — assert
  // presence, not multiplicity.
  expect((await screen.findAllByText('14,772,410')).length).toBeGreaterThan(0)
  expect(screen.getAllByText('22,158,326').length).toBeGreaterThan(0)
  expect(screen.getAllByText('34,468,532').length).toBeGreaterThan(0)
  expect(screen.getAllByText('174,800,732').length).toBeGreaterThan(0)
})

test('a payload without model data renders no bars — never fabricated', () => {
  render(
    <MilestoneCostTrendSection
      costRollup={{
        tokenCost: 1_000,
        activeTimeSec: 10,
        measuredTasks: 1,
        totalTasks: 2,
        models: [],
        modelUnattributedTokens: 1_000,
      }}
      burnup={undefined}
      deliveryStats={undefined}
      memberDelivery={undefined}
    />
  )
  expect(screen.queryAllByTestId('model-usage-row')).toHaveLength(0)
  // No model rows → no unattributed line either (nothing to contrast against).
  expect(screen.queryByText(/not attributed to a model/)).toBeNull()
})
