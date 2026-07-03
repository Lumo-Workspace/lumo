/** @jest-environment jsdom */
// LUM-638 — riskQueue 段是行动入口:行链到任务或越界面板,全空渲染显式
// 空态而非隐藏,顶层 section(h2)数 ≤ 7。

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

import { render, screen } from '@testing-library/react'
import { MilestoneOverviewTab } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab'
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

const riskQueue: NonNullable<ApiMilestone['riskQueue']> = {
  blocked: [
    {
      taskId: 't2',
      ref: 'LUM-2',
      title: 'Blocked task',
      blockingRef: 'LUM-9',
      blockingStatus: 'IN_PROGRESS',
    },
  ],
  awaitingVerdict: [
    { taskId: 't1', ref: 'LUM-1', title: 'In review task', agingSec: 207360 }, // 2.4d
    { taskId: 't6', ref: 'LUM-6', title: 'Unknown aging', agingSec: null },
  ],
  crossings: {
    known: true,
    bySeverity: { high: 1, medium: 1, low: 0 },
    tasks: [
      {
        taskId: 't3',
        ref: 'LUM-3',
        title: 'Crossing task',
        high: 1,
        medium: 1,
        low: 0,
      },
    ],
  },
  verifyEscalated: [
    { taskId: 't4', ref: 'LUM-4', title: 'Escalated', round: 3 },
  ],
  scopeBaseline: { initial: 12, current: 15, addedLater: 3 },
}

const emptyRiskQueue: NonNullable<ApiMilestone['riskQueue']> = {
  blocked: [],
  awaitingVerdict: [],
  crossings: {
    known: true,
    bySeverity: { high: 0, medium: 0, low: 0 },
    tasks: [],
  },
  verifyEscalated: [],
  scopeBaseline: { initial: 12, current: 12, addedLater: 0 },
}

test('renders risk queue as actionable section', () => {
  const { rerender } = render(
    <MilestoneOverviewTab
      milestone={{ ...fullMilestone, riskQueue }}
      onUpdate={() => {}}
      workspaceUrl='acme'
    />
  )
  // 行是链接,href 指向任务详情;越界行带 #boundary-crossings 锚
  const links = screen.getAllByRole('link')
  const hrefs = links.map(l => l.getAttribute('href'))
  expect(hrefs).toContain('/workspace/acme/my-tasks/LUM-2')
  expect(hrefs).toContain('/workspace/acme/my-tasks/LUM-1')
  expect(hrefs).toContain('/workspace/acme/my-tasks/LUM-3#boundary-crossings')
  expect(hrefs).toContain('/workspace/acme/my-tasks/LUM-4')
  // aging unknown 显式呈现
  expect(
    screen.getByText('milestone.riskQueue.review.agingUnknown')
  ).toBeTruthy()
  // 顶层 section 计数 ≤ 7(以 h2 计)
  expect(
    screen.getAllByRole('heading', { level: 2 }).length
  ).toBeLessThanOrEqual(7)

  // 全部无待决 → 显式空态,段不消失
  rerender(
    <MilestoneOverviewTab
      milestone={{ ...fullMilestone, riskQueue: emptyRiskQueue }}
      onUpdate={() => {}}
      workspaceUrl='acme'
    />
  )
  expect(screen.getByText('milestone.riskQueue.title')).toBeTruthy()
  expect(screen.getByText('milestone.riskQueue.empty.title')).toBeTruthy()
})

test('renders crossings unknown copy when read failed', () => {
  render(
    <MilestoneOverviewTab
      milestone={{
        ...fullMilestone,
        riskQueue: { ...riskQueue, crossings: { known: false as const } },
      }}
      onUpdate={() => {}}
      workspaceUrl='acme'
    />
  )
  expect(
    screen.getByText('milestone.riskQueue.crossings.unknownTitle')
  ).toBeTruthy()
  // unknown ≠ 0:不出现 0 计数文案
  expect(screen.queryByText(/HIGH 0/)).toBeNull()
})
