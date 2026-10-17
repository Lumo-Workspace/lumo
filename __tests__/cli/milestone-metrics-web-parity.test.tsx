/** @jest-environment jsdom */

/**
 * LUM-1190 — `milestone show`'s Metrics section and the web metric strip,
 * rendered from ONE fixture, must show the same numbers: every total and
 * every by-task value the strip prints (with each chip expanded) appears in
 * the CLI output too.
 */

import en from '@/lib/i18n/en.json'

const messages = en as Record<string, string>

// The shipped en copy, with the one ICU plural shape the strip uses
// (`{count, plural, one {# PR} other {# PRs}}`) resolved.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = messages[id] ?? defaultMessage ?? id
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.replace(
          new RegExp(
            `\\{${k}, plural, one \\{([^}]*)\\} other \\{([^}]*)\\}\\}`
          ),
          (_m, one: string, other: string) =>
            (Number(v) === 1 ? one : other).replace('#', String(v))
        )
        msg = msg.replace(`{${k}}`, String(v))
      }
      return msg
    },
  }),
}))

import { render, screen, fireEvent, within } from '@testing-library/react'
import { MilestoneMetricStrip } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneMetricStrip'
import { milestoneMetricsLines } from '@/cli/src/lib/milestone-metrics'

type Props = React.ComponentProps<typeof MilestoneMetricStrip>

const model = (name: string, total: number) => ({
  model: name,
  total,
  output: 0,
  input: 0,
  cacheCreation: 0,
  cacheRead: total,
})

const fixture = {
  costRollup: {
    tokenCost: 283_500_000,
    activeTimeSec: 10_740,
    measuredTasks: 2,
    totalTasks: 8,
  },
  budget: {
    tokenBudget: 400_000_000,
    tokenCost: 283_500_000,
    usedRatio: 0.70875,
    exceeded: false,
    overBy: null,
  },
  deliveryStats: {
    pr: {
      mergedPrCount: 5,
      multiPrTaskCount: 1,
      unlinkedTaskCount: 6,
      linkedTaskCount: 2,
      totalTasks: 8,
    },
    changedFiles: { total: 12, measuredTasks: 2, totalTasks: 8 },
    perMember: {
      measuredTasks: 2,
      tokenCost: 283_500_000,
      activeTimeSec: 10_740,
      rows: [],
    },
    perTask: {
      rows: [
        {
          taskId: 't1',
          ref: 'LUM-497',
          title: 'reference-class anchors',
          tokenCost: 201_200_000,
          models: [
            model('claude-opus-5', 168_400_000),
            model('claude-haiku-5', 32_800_000),
          ],
          modelUnattributedTokens: 0,
          activeTimeSec: 7_500,
          prCount: 4,
          multiPr: true,
          changeVolume: { additions: 2_100, deletions: 140, measuredPrs: 4 },
        },
        {
          taskId: 't2',
          ref: 'LUM-707',
          title: 'deferred cleanups',
          tokenCost: 82_300_000,
          models: [],
          modelUnattributedTokens: 82_300_000,
          activeTimeSec: 3_240,
          prCount: 1,
          multiPr: false,
          changeVolume: null,
        },
      ],
      unattributedActiveTimeSec: 0,
    },
  },
} as unknown as Props

const cli = milestoneMetricsLines(
  fixture as unknown as Parameters<typeof milestoneMetricsLines>[0]
).join('\n')

const openChip = (labelId: string) =>
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(messages[labelId]!) })
  )

/** The numbers a by-task row of the strip shows (ref + figures, no title). */
const rowFigures = () =>
  screen.getAllByTestId('metric-task-row').map(row => row.textContent ?? '')

test('chip totals match', () => {
  render(<MilestoneMetricStrip {...fixture} />)
  for (const total of ['283.5M', '2h 59m', '5']) {
    expect(screen.getByText(total)).toBeTruthy()
  }
  expect(cli).toContain('Tokens:       283.5M')
  expect(cli).toContain('Active time:  2h 59m')
  expect(cli).toContain('Merged PRs:   5')
})

test('tokens panel: per-task tokens, per-model split, coverage and budget match', () => {
  render(<MilestoneMetricStrip {...fixture} />)
  openChip('milestone.costTrend.tokens')
  const rows = rowFigures()
  expect(rows[0]).toContain('LUM-497')
  expect(rows[0]).toContain('201.2M')
  expect(rows[0]).toContain('168.4M')
  expect(rows[0]).toContain('32.8M')
  expect(rows[1]).toContain('LUM-707')
  expect(rows[1]).toContain('82.3M')
  expect(cli).toMatch(
    /LUM-497\t201\.2M tokens\treference-class anchors\n +claude-opus-5 168\.4M · claude-haiku-5 32\.8M/
  )
  expect(cli).toMatch(/LUM-707\t82\.3M tokens\tdeferred cleanups/)
  // Coverage + budget lines
  expect(screen.getByText('measured on 2 of 8 tasks')).toBeTruthy()
  expect(screen.getByTestId('token-budget-line').textContent).toContain(
    '71% of 400M token budget'
  )
  expect(cli).toContain('(measured on 2 of 8 tasks)')
  expect(cli).toContain('Budget:       71% of 400M token budget')
})

test('active-time panel: per-task durations match', () => {
  render(<MilestoneMetricStrip {...fixture} />)
  openChip('milestone.costTrend.activeTime')
  const rows = rowFigures()
  expect(rows[0]).toContain('2h 5m')
  expect(rows[1]).toContain('54m')
  expect(cli).toMatch(/LUM-497\t2h 5m\treference-class anchors/)
  expect(cli).toMatch(/LUM-707\t54m\tdeferred cleanups/)
})

test('PRs panel: PR counts, multi-PR (rework) and change volume match', () => {
  render(<MilestoneMetricStrip {...fixture} />)
  openChip('milestone.deliveryStats.mergedPrs')
  const [first, second] = screen.getAllByTestId('metric-task-row')
  expect(first!.textContent).toContain('4 PRs')
  expect(within(first!).getByTestId('multi-pr-chip')).toBeTruthy()
  expect(within(first!).getByTestId('change-volume').textContent).toBe(
    '+2.1K/−140'
  )
  expect(second!.textContent).toContain('1 PR')
  expect(second!.textContent).toContain('No synced PRs')
  expect(cli).toMatch(
    /LUM-497\t4 PRs\tmulti-PR\t\+2\.1K\/−140\treference-class anchors/
  )
  expect(cli).toMatch(/LUM-707\t1 PR\t\tno synced PRs\tdeferred cleanups/)
})
