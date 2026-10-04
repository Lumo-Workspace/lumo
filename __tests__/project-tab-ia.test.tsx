/** @jest-environment jsdom */
/**
 * LUM-712: project detail information architecture. Overview and Signal were
 * two tabs answering the same question ("how is this project doing"), so
 * reading either alone was misleading. They are now one Project tab, and the
 * count that used to require opening Signal rides on its label.
 */

jest.mock('react-intl', () => {
  const en = require('@/lib/i18n/en.json') as Record<string, string>
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, unknown>
      ) => {
        let msg = en[id] ?? defaultMessage ?? id
        for (const [k, v] of Object.entries(values ?? {})) {
          msg = msg.split(`{${k}}`).join(String(v))
        }
        return msg
      },
    }),
  }
})

const mockStats = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useRealtimeStats', () => ({
  useProjectRealtimeStats: () => mockStats(),
}))

// The tab bodies are covered by their own suites; here they are stubs so the
// assertions are about which tab is showing, not what it renders.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectHeader',
  () => ({ ProjectHeader: () => <div data-testid='project-header' /> })
)
const projectTabProps = jest.fn()
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectTab',
  () => ({
    ProjectTab: (props: Record<string, unknown>) => {
      projectTabProps(props)
      return <div data-testid='body-project' />
    },
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectTasksTab',
  () => ({ ProjectTasksTab: () => <div data-testid='body-tasks' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/ProjectMilestonesTab',
  () => ({ ProjectMilestonesTab: () => <div data-testid='body-milestones' /> })
)
jest.mock('@/app/workspace/[workspaceUrl]/components/memory/MemoryTab', () => ({
  MemoryTab: () => <div data-testid='body-memory' />,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectDetailPage } from '@/app/workspace/[workspaceUrl]/components/pages/ProjectDetailPage'
import type { ApiProject } from '@/app/workspace/[workspaceUrl]/types'
import type { TaskSummaryStats, TopBlockers } from '@/types/summary'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-07-28T00:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString()

const emptyBlockers: TopBlockers = {
  overdueTaskIds: [],
  stalledTaskIds: [],
  failingAgentTaskIds: [],
  staleOpenPrNumbers: [],
  staleOpenPrs: [],
  highStakesTaskIds: [],
}

function makeStats(
  blockers: Partial<TopBlockers> = {},
  over: Partial<TaskSummaryStats> = {}
): TaskSummaryStats {
  return {
    totalTasks: 10,
    statusDistribution: { DONE: 4 },
    priorityDistribution: {},
    overdueTasks: { count: 0, taskIds: [] },
    memberWorkload: [],
    completionTrend: [],
    avgCompletionTime: null,
    agentStats: { total: 0, completed: 0, failed: 0, working: 0 },
    prStats: { total: 0, merged: 0, open: 0 },
    topBlockers: { ...emptyBlockers, ...blockers },
    ...over,
  }
}

const stalled = (id: string, days = 9) => ({
  id,
  identifier: `LUM-${id}`,
  title: `Task ${id}`,
  updatedAt: daysAgo(days),
  priority: 'MEDIUM' as const,
})

const project = {
  id: 'p1',
  name: 'Lumo',
  description: null,
  isIdea: false,
  ownerId: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  _count: { tasks: 0 },
  todoCount: 0,
  inProgressCount: 0,
  inReviewCount: 0,
  doneCount: 0,
  owner: null,
} as ApiProject

function setup(stats: TaskSummaryStats | null) {
  mockStats.mockReturnValue({ stats, loading: false, error: null })
  return render(
    <ProjectDetailPage
      project={project}
      tasks={[]}
      setTasks={jest.fn()}
      viewId={null}
      loading={false}
      error={null}
      onRetry={jest.fn()}
      onBack={jest.fn()}
      onNewTask={jest.fn()}
      onTaskClick={jest.fn()}
      onDeleteTask={jest.fn()}
      onTaskStatusChanged={jest.fn()}
      onUpdateProject={jest.fn()}
      onDeleteProject={jest.fn()}
      members={[]}
      workspaceUrl='acme'
    />
  )
}

beforeEach(() => {
  mockStats.mockReset()
  projectTabProps.mockReset()
})

describe('project detail tabs', () => {
  it('project detail exposes exactly Project, Milestones, Tasks, Memory tabs and defaults to Project', () => {
    setup(makeStats())

    const tabs = screen
      .getAllByRole('tab')
      .map(b => b.textContent?.trim())
      .filter(Boolean)
    expect(tabs).toEqual(['Project', 'Milestones', 'Tasks', 'Memory'])

    // The segmented control announces which one is current, not just which one
    // is tinted — the raised chip is a visual cue only.
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(
      'Project'
    )

    // The merged tabs are gone, not renamed alongside the new one.
    expect(screen.queryByText('Overview')).not.toBeInTheDocument()
    expect(screen.queryByText('Signal')).not.toBeInTheDocument()

    // Project is where the page lands.
    expect(screen.getByTestId('body-project')).toBeInTheDocument()
    expect(screen.queryByTestId('body-tasks')).not.toBeInTheDocument()
  })

  it('carries no count badge on any tab', () => {
    // The tabs name the views; the health row inside Project is where the
    // numbers live. A badge here would restate them in a second place that can
    // drift.
    setup(
      makeStats(
        {
          stalledTaskIds: [stalled('1'), stalled('2'), stalled('3')],
          staleOpenPrs: [
            { number: 1, openedAt: daysAgo(6), url: 'https://x/1' },
          ],
        },
        { overdueTasks: { count: 4, taskIds: ['a', 'b', 'c', 'd'] } }
      )
    )

    expect(screen.queryByTestId('project-tab-badge')).not.toBeInTheDocument()
    const tabs = screen.getAllByRole('tab').map(t => t.textContent?.trim())
    expect(tabs).toEqual(['Project', 'Milestones', 'Tasks', 'Memory'])
    // Label only — no digits smuggled in beside a name.
    tabs.forEach(label => expect(label).not.toMatch(/\d/))
  })

  it('unpacks the blocker lists for the Project tab instead of handing it the stats payload', () => {
    // The tab renders panels from these three lists; if the page mis-maps them
    // the panels silently show the wrong rows, which types alone can't catch.
    setup(
      makeStats({
        stalledTaskIds: [stalled('1'), stalled('2')],
        highStakesTaskIds: [stalled('1')],
        staleOpenPrs: [{ number: 9, openedAt: daysAgo(4), url: 'https://x/9' }],
      })
    )

    const props = projectTabProps.mock.calls[0]?.[0]
    expect(props.stalled.map((t: { id: string }) => t.id)).toEqual(['1', '2'])
    expect(props.highStakes.map((t: { id: string }) => t.id)).toEqual(['1'])
    expect(props.stalePrs.map((p: { number: number }) => p.number)).toEqual([9])
    expect(props.stats).toBeUndefined()
  })

  it('gives the Project tab empty blocker lists before stats arrive', () => {
    setup(null)

    const props = projectTabProps.mock.calls[0]?.[0]
    expect(props.stalled).toEqual([])
    expect(props.highStakes).toEqual([])
    expect(props.stalePrs).toEqual([])
  })

  it('switches bodies when another tab is picked', () => {
    setup(makeStats())

    fireEvent.click(screen.getByText('Tasks'))
    expect(screen.getByTestId('body-tasks')).toBeInTheDocument()
    expect(screen.queryByTestId('body-project')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Milestones'))
    expect(screen.getByTestId('body-milestones')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Memory'))
    expect(screen.getByTestId('body-memory')).toBeInTheDocument()
  })
})
