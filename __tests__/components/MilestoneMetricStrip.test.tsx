/** @jest-environment jsdom */

/**
 * LUM-727 — the single-page metric strip (tokens · active time · merged PRs).
 *
 * Carries forward the honesty contract of the retired KPI row: an unmeasured
 * total must read an explicit "not measured", a milestone with no PR records
 * must say so, and an unsynced diff must never render +0/−0. Zero is a
 * measurement, not a default.
 */

import en from '@/lib/i18n/en.json'

const messages = en as Record<string, string>
/** Shipped copy for an id — the assertions read the real translation. */
const m = (id: string): string => messages[id] ?? id

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = messages[id] ?? defaultMessage ?? id
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.replace(`{${k}}`, String(v))
      }
      return msg
    },
  }),
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ApiMilestone } from '@/lib/api-client'
import { MilestoneMetricStrip } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneMetricStrip'

type Props = React.ComponentProps<typeof MilestoneMetricStrip>

const measured = {
  costRollup: {
    tokenCost: 283_500_000,
    activeTimeSec: 10_740,
    measuredTasks: 2,
    totalTasks: 8,
  },
  deliveryStats: {
    pr: {
      mergedPrCount: 5,
      multiPrTaskCount: 1,
      unlinkedTaskCount: 2,
      linkedTaskCount: 2,
    },
    changedFiles: { total: 12, measuredTasks: 2, totalTasks: 8 },
    changeVolume: {
      additions: 2_800,
      deletions: 195,
      measuredPrs: 5,
      totalMergedPrs: 5,
    },
  },
} as unknown as Props

test('reads an explicit not-measured state instead of a fabricated zero', () => {
  const { container } = render(
    <MilestoneMetricStrip
      costRollup={
        {
          tokenCost: null,
          activeTimeSec: 0,
          measuredTasks: 0,
          totalTasks: 8,
        } as ApiMilestone['costRollup']
      }
      deliveryStats={
        {
          pr: {
            mergedPrCount: 0,
            multiPrTaskCount: 0,
            unlinkedTaskCount: 8,
            linkedTaskCount: 0,
          },
          changedFiles: { total: null, measuredTasks: 0, totalTasks: 8 },
          changeVolume: {
            additions: null,
            deletions: null,
            measuredPrs: 0,
            totalMergedPrs: 0,
          },
        } as unknown as ApiMilestone['deliveryStats']
      }
    />
  )

  // Both spend chips read the explicit unmeasured state — never "0" / "0s".
  expect(
    screen.getAllByText(m('milestone.costTrend.notMeasured'))
  ).toHaveLength(2)
  expect(
    screen.getByText(m('milestone.deliveryStats.noPrRecords'))
  ).toBeInTheDocument()
  expect(container.textContent).not.toContain('0s')

  // Expanding PRs still refuses to fabricate a +0/−0 diff.
  fireEvent.click(
    screen.getByRole('button', {
      name: new RegExp(m('milestone.deliveryStats.mergedPrs')),
    })
  )
  expect(
    screen.getByText(m('milestone.changeVolume.notSynced'))
  ).toBeInTheDocument()
  expect(screen.queryByTestId('change-volume')).not.toBeInTheDocument()
})

test('renders measured totals and expands one metric at a time', () => {
  render(<MilestoneMetricStrip {...measured} />)

  expect(screen.getByText('283.5M')).toBeInTheDocument()
  expect(screen.getByText('2h 59m')).toBeInTheDocument()
  expect(screen.getByText('5')).toBeInTheDocument()

  const tokensChip = screen.getByRole('button', {
    name: new RegExp(m('milestone.costTrend.tokens')),
  })
  fireEvent.click(tokensChip)
  expect(tokensChip).toHaveAttribute('aria-expanded', 'true')
  expect(
    screen.getByText(
      m('milestone.costTrend.coverage')
        .replace('{measured}', '2')
        .replace('{total}', '8')
    )
  ).toBeInTheDocument()

  // Opening another chip closes the first — one panel at a time.
  fireEvent.click(
    screen.getByRole('button', {
      name: new RegExp(m('milestone.deliveryStats.mergedPrs')),
    })
  )
  expect(tokensChip).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByTestId('change-volume')).toBeInTheDocument()
})

test('renders nothing when the payload carries no rollup at all', () => {
  const { container } = render(
    <MilestoneMetricStrip costRollup={undefined} deliveryStats={undefined} />
  )
  expect(container).toBeEmptyDOMElement()
})
