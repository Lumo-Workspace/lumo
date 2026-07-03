/** @jest-environment jsdom */
// LUM-645 — "推荐下一批"段:ready 行链到任务并带解锁数/关键路径标记,
// 关键路径渲染为链,环显式警告,无确认边/无 ready 两种空态都不隐藏段。

const messages: Record<string, string> = {
  'milestone.topology.batch.unblocks': 'unblocks {count}',
  'milestone.topology.batch.count': '{count} ready',
  'milestone.topology.batch.stillBlocked': '{count} still blocked',
  'milestone.topology.criticalPath.depth': '{levels} levels · {length} tasks',
  'milestone.topology.cycle.body': 'blocking each other: {refs}',
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
import { MilestoneTopologySection } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneTopologySection'
import type { ApiMilestone } from '@/lib/api-client/milestones'

type Topology = NonNullable<ApiMilestone['topology']>

const baseTopology: Topology = {
  edgeCount: 3,
  levels: [['LUM-1'], ['LUM-2'], ['LUM-3']],
  criticalPath: [
    { taskId: 't1', ref: 'LUM-1', title: 'Head', status: 'DONE' },
    { taskId: 't2', ref: 'LUM-2', title: 'Mid', status: 'TODO' },
    { taskId: 't3', ref: 'LUM-3', title: 'Tail', status: 'TODO' },
  ],
  cycleRefs: [],
  nextBatch: [
    {
      taskId: 't2',
      ref: 'LUM-2',
      title: 'Mid',
      status: 'TODO',
      unblocksCount: 2,
      onCriticalPath: true,
    },
    {
      taskId: 't5',
      ref: 'LUM-5',
      title: 'Side quest',
      status: 'IN_PROGRESS',
      unblocksCount: 0,
      onCriticalPath: false,
    },
  ],
  blockedOpenCount: 1,
}

test('ready rows link to tasks with unblocks + critical-path meta; critical path renders as a chain', () => {
  render(
    <MilestoneTopologySection topology={baseTopology} workspaceUrl='acme' />
  )

  const hrefs = screen.getAllByRole('link').map(l => l.getAttribute('href'))
  expect(hrefs).toEqual([
    '/workspace/acme/my-tasks/LUM-2',
    '/workspace/acme/my-tasks/LUM-5',
  ])

  expect(screen.getByText('milestone.topology.title')).toBeTruthy()
  // 解锁数 + 关键路径标记走 i18n
  expect(
    screen.getByText(/unblocks 2 · milestone.topology.batch.critical/)
  ).toBeTruthy()
  // in-flight 状态在 meta 中呈现(status.* 走 i18n)
  expect(screen.getByText('status.inProgress')).toBeTruthy()
  // count 行:2 ready · 1 still blocked
  expect(screen.getByText(/2 ready/)).toBeTruthy()
  expect(screen.getByText(/1 still blocked/)).toBeTruthy()
  // 关键路径链:DONE 节点带 ✓,深度行有层数
  expect(screen.getByText(/LUM-1 ✓ → LUM-2 → LUM-3/)).toBeTruthy()
  expect(screen.getByText('3 levels · 3 tasks')).toBeTruthy()
  // 无环 → 无警告
  expect(screen.queryByText('milestone.topology.cycle.title')).toBeNull()
})

test('no confirmed edges → explicit empty state, no fabricated order', () => {
  render(
    <MilestoneTopologySection
      topology={{
        edgeCount: 0,
        levels: [],
        criticalPath: [],
        cycleRefs: [],
        nextBatch: [
          {
            taskId: 't1',
            ref: 'LUM-1',
            title: 'Loose task',
            status: 'TODO',
            unblocksCount: 0,
            onCriticalPath: false,
          },
        ],
        blockedOpenCount: 0,
      }}
      workspaceUrl='acme'
    />
  )
  expect(
    screen.getByText('milestone.topology.empty.noEdges.title')
  ).toBeTruthy()
  // 空态下不渲染任务行
  expect(screen.queryAllByRole('link')).toHaveLength(0)
})

test('edges exist but nothing ready → all-blocked empty state; all done → done empty state', () => {
  const noneReady: Topology = {
    ...baseTopology,
    nextBatch: [],
    blockedOpenCount: 2,
  }
  const { rerender } = render(
    <MilestoneTopologySection topology={noneReady} workspaceUrl='acme' />
  )
  expect(
    screen.getByText('milestone.topology.empty.noneReady.title')
  ).toBeTruthy()

  rerender(
    <MilestoneTopologySection
      topology={{ ...noneReady, blockedOpenCount: 0 }}
      workspaceUrl='acme'
    />
  )
  expect(screen.getByText('milestone.topology.empty.done.title')).toBeTruthy()
})

test('dependency cycle renders an explicit warning naming the members', () => {
  render(
    <MilestoneTopologySection
      topology={{ ...baseTopology, cycleRefs: ['LUM-7', 'LUM-8'] }}
      workspaceUrl='acme'
    />
  )
  expect(screen.getByText('milestone.topology.cycle.title')).toBeTruthy()
  expect(screen.getByText(/LUM-7 ↔ LUM-8/)).toBeTruthy()
})

test('null topology renders nothing (older payloads)', () => {
  const { container } = render(
    <MilestoneTopologySection topology={null} workspaceUrl='acme' />
  )
  expect(container.firstChild).toBeNull()
})
