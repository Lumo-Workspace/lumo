/** @jest-environment jsdom */

// LUM-636 — mission-control IA of the milestone Overview: section order,
// the description's move to its own tab, and the three-state fail-closed
// copy surviving the redesign.

const messages: Record<string, string> = {
  'milestone.tab.overview': 'Overview',
  'milestone.tab.tasks': 'Tasks',
  'milestone.tab.description': 'Description',
  'milestone.costTrend.notMeasured': 'Not measured',
  'milestone.costTrend.coverage': 'measured on {measured} of {total} tasks',
  'milestone.changeVolume.coverage':
    'synced on {measured} of {total} merged PRs',
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
// nothing — replace with a fixed-size passthrough so the burnup mounts.
jest.mock('recharts', () => {
  const Original = jest.requireActual('recharts')
  const React = jest.requireActual('react')
  return {
    ...Original,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 500, height: 300 }),
  }
})

// DescriptionEditor pulls Tiptap — stub the lazy wrapper to a marker.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/DescriptionEditorLazy',
  () => ({
    DescriptionEditor: () => <div data-testid='desc-editor'>editor</div>,
  })
)

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMentionSources', () => ({
  useMentionSources: () => [],
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneTasksTab',
  () => ({
    MilestoneTasksTab: () => <div data-testid='tasks-body'>tasks</div>,
  })
)

import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MilestoneOverviewTab } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab'
import { MilestoneDetailTabs } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneDetailTabs'
import { MilestoneCostTrendSection } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneCostTrendSection'
import type { ApiMilestone } from '@/lib/api-client/milestones'

const fullMilestone = {
  id: 'm1',
  name: 'Honest dashboard',
  startDate: '2026-06-29T00:00:00.000Z',
  targetDate: null,
  taskCounts: { TODO: 0, IN_PROGRESS: 1, IN_REVIEW: 0, DONE: 7 },
  health: null,
  summaryTldr: 'All milestone tasks completed with zero rework.',
  sprintCoverage: {
    sprints: [
      {
        sprintId: 's6',
        number: 6,
        name: 'Sprint 6',
        status: 'ACTIVE',
        taskCount: 8,
        doneCount: 7,
      },
    ],
    unsprinted: 0,
  },
  outcome: {
    claims: [
      {
        taskId: 't1',
        ref: 'LUM-1',
        title: 'T1',
        claim: 'shipped it',
        source: 'AGENT',
      },
    ],
    fate: { doneCount: 7, rejected: [], inconclusiveCount: 7 },
  },
  costRollup: {
    tokenCost: 384_300_000,
    activeTimeSec: 16_260,
    measuredTasks: 8,
    totalTasks: 8,
  },
  burnup: {
    start: '2026-06-29',
    end: '2026-07-02',
    unit: 'tasks',
    scopeTotal: 8,
    series: [
      { date: '2026-06-29', scope: 8, completed: 2 },
      { date: '2026-07-02', scope: 8, completed: 7 },
    ],
    sprintWindows: [
      {
        sprintId: 's6',
        number: 6,
        name: 'Sprint 6',
        start: '2026-06-29',
        end: '2026-07-12',
      },
    ],
  },
  segments: {
    tasks: [
      { taskId: 't1', ref: 'LUM-1', title: 'T1', status: 'DONE' },
      { taskId: 't2', ref: 'LUM-2', title: 'T2', status: 'IN_PROGRESS' },
    ],
    sprint: [
      { key: 's6', label: 'Sprint 6', taskIds: ['t1', 't2'], doneCount: 1 },
    ],
    priority: [
      { key: 'MEDIUM', label: null, taskIds: ['t1', 't2'], doneCount: 1 },
    ],
    workstream: [
      { key: 'NONE', label: null, taskIds: ['t1', 't2'], doneCount: 1 },
    ],
  },
  deliveryStats: {
    pr: {
      mergedPrCount: 9,
      multiPrTaskCount: 1,
      linkedTaskCount: 7,
      unlinkedTaskCount: 0,
      totalTasks: 8,
    },
    changedFiles: { total: 120, measuredTasks: 8, totalTasks: 8 },
    changeVolume: {
      additions: 10_300,
      deletions: 263,
      changedFiles: 120,
      measuredPrs: 9,
      totalMergedPrs: 9,
    },
    perMember: {
      measuredTasks: 8,
      tokenCost: 384_300_000,
      activeTimeSec: 16_260,
      rows: [
        {
          memberId: 'mA',
          label: 'Chao Li',
          tokenCost: 238_900_000,
          activeTimeSec: 10_080,
        },
      ],
    },
  },
  memberDelivery: {
    rows: [
      {
        bucket: 'member',
        memberId: 'mA',
        label: 'Chao Li',
        taskCount: 5,
        doneCount: 4,
        mergedPrCount: 5,
        fate: { rejectedTaskCount: 0, noRecordDoneCount: 4 },
        friction: { failRoundCount: 0, sendBackCount: 0, multiPrTaskCount: 1 },
        changedFiles: { total: 60, measuredTasks: 5 },
        claims: [],
      },
    ],
  },
} as unknown as ApiMilestone

/** a precedes b in document order. */
function expectBefore(a: HTMLElement, b: HTMLElement) {
  expect(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
}

test('overview renders mission-control sections in order without description editor', () => {
  render(
    <MilestoneOverviewTab
      milestone={fullMilestone}
      onUpdate={() => {}}
      workspaceUrl='acme'
    />
  )

  // Hero: progress ring numbers + eyebrow with the covering sprint + key
  // outcome + the health/dates stat column.
  const hero = screen.getByText('milestone.rollup.keyOutcome')
  expect(screen.getByText('88%')).toBeInTheDocument()
  expect(screen.getByText(/Sprint 6/)).toBeInTheDocument()
  expect(
    screen.getByText('milestone.hero.healthUnavailable')
  ).toBeInTheDocument()
  // No target date → the schedule hint states why health is off.
  expect(screen.getByText('milestone.hero.scheduleHint')).toBeInTheDocument()

  const kpi = screen.getByText('milestone.costTrend.tokens')
  const burnupTitle = screen.getByText('milestone.costTrend.burnupTitle')
  const quality = screen.getByText('milestone.quality.title')
  const member = screen.getByText('milestone.memberDelivery.tableTitle')
  const evidence = screen.getByText('milestone.taskEvidence.title')

  expectBefore(hero, kpi)
  expectBefore(kpi, burnupTitle)
  expectBefore(burnupTitle, quality)
  expectBefore(quality, member)
  expectBefore(member, evidence)

  // The description editor is no longer part of the Overview.
  expect(screen.queryByTestId('desc-editor')).toBeNull()
})

test('hero start date falls back to the first task work start', () => {
  const { unmount } = render(
    <MilestoneOverviewTab
      milestone={{
        id: 'm1',
        name: 'Beta',
        startDate: null,
        derivedStartDate: '2026-06-29T10:00:00.000Z',
        targetDate: null,
      }}
      onUpdate={() => {}}
      workspaceUrl='acme'
    />
  )
  // No explicit startDate → the activity-derived first-work-start renders,
  // never the "not set" placeholder.
  expect(
    screen.getByTitle('milestone.hero.startDerivedHint')
  ).toBeInTheDocument()
  expect(screen.queryAllByText('milestone.hero.notSet')).toHaveLength(0)
  unmount()

  // An explicitly set startDate wins over the derived one.
  render(
    <MilestoneOverviewTab
      milestone={{
        id: 'm1',
        name: 'Beta',
        startDate: '2026-06-20T00:00:00.000Z',
        derivedStartDate: '2026-06-29T10:00:00.000Z',
        targetDate: null,
      }}
      onUpdate={() => {}}
      workspaceUrl='acme'
    />
  )
  expect(screen.queryByTitle('milestone.hero.startDerivedHint')).toBeNull()
  expect(screen.getByText(/Jun 20/)).toBeInTheDocument()
})

test('set date opens the native picker and commits the chosen date', () => {
  const showPicker = jest.fn()
  ;(
    HTMLInputElement.prototype as HTMLInputElement & {
      showPicker: () => void
    }
  ).showPicker = showPicker
  const onUpdate = jest.fn()
  render(
    <MilestoneOverviewTab
      milestone={{
        id: 'm1',
        name: 'Beta',
        startDate: null,
        derivedStartDate: null,
        targetDate: null,
      }}
      onUpdate={onUpdate}
      workspaceUrl='acme'
    />
  )
  const cta = screen.getByRole('button', { name: 'milestone.hero.setDate' })
  fireEvent.click(cta)
  expect(showPicker).toHaveBeenCalledTimes(1)

  const input = screen.getByLabelText('milestone.field.targetDate')
  fireEvent.change(input, { target: { value: '2026-07-12' } })
  expect(onUpdate).toHaveBeenCalledWith({ targetDate: '2026-07-12' })
})

test('description renders in its own tab with i18n label', async () => {
  const user = userEvent.setup()
  render(
    <MilestoneDetailTabs
      milestone={
        {
          id: 'm1',
          name: 'Beta',
          description: '<p>body</p>',
          startDate: null,
          targetDate: null,
          archivedAt: null,
          sprintCoverage: null,
        } as never
      }
      onUpdate={() => {}}
      members={[]}
      workspaceUrl='acme'
      sidebarCollapsed={false}
      onToggleSidebar={() => {}}
      onOpenTask={() => {}}
    />
  )

  // All three tab labels resolve through i18n keys.
  expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Tasks' })).toBeInTheDocument()
  const descTab = screen.getByRole('button', { name: 'Description' })

  // Overview default: no editor on screen.
  expect(screen.queryByTestId('desc-editor')).toBeNull()

  await user.click(descTab)
  expect(screen.getByTestId('desc-editor')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Overview' }))
  expect(screen.queryByTestId('desc-editor')).toBeNull()
})

test('null token cost renders not-measured and coverage footnotes render n of m', () => {
  const { container } = render(
    <MilestoneCostTrendSection
      costRollup={{
        tokenCost: null,
        activeTimeSec: 0,
        measuredTasks: 0,
        totalTasks: 8,
      }}
      burnup={undefined}
      deliveryStats={{
        pr: {
          mergedPrCount: 9,
          multiPrTaskCount: 1,
          linkedTaskCount: 7,
          unlinkedTaskCount: 0,
          totalTasks: 8,
        },
        changedFiles: { total: null, measuredTasks: 0, totalTasks: 8 },
        changeVolume: {
          additions: 10_300,
          deletions: 263,
          changedFiles: 120,
          measuredPrs: 3,
          totalMergedPrs: 9,
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

  // Unmeasured tokens read the explicit placeholder — never a fabricated 0.
  const tokensLabel = screen.getByText('milestone.costTrend.tokens')
  const tokensValue = tokensLabel.nextElementSibling as HTMLElement
  expect(tokensValue.textContent).toBe('Not measured')
  expect(tokensValue.textContent).not.toMatch(/\b0\b/)

  // Coverage footnotes state n-of-m on the token KPI (and again on the
  // quality card's change surface) and on the change-volume KPI.
  expect(
    screen.getAllByText('measured on 0 of 8 tasks').length
  ).toBeGreaterThan(0)
  expect(screen.getByText('synced on 3 of 9 merged PRs')).toBeInTheDocument()

  // The unmeasured change surface fail-closes on the quality card too.
  expect(container.textContent).toContain('milestone.quality.changeSurface')
})
