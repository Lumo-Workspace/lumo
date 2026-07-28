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
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectTab',
  () => ({ ProjectTab: () => <div data-testid='body-project' /> })
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
    subtaskCompletionRate: null,
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

beforeEach(() => mockStats.mockReset())

describe('project detail tabs', () => {
  it('project detail exposes exactly Project, Milestones, Tasks, Memory tabs and defaults to Project', () => {
    setup(makeStats())

    const tabs = screen
      .getAllByRole('button')
      .map(b => b.textContent?.trim())
      .filter(Boolean)
    expect(tabs).toEqual(['Project', 'Milestones', 'Tasks', 'Memory'])

    // The merged tabs are gone, not renamed alongside the new one.
    expect(screen.queryByText('Overview')).not.toBeInTheDocument()
    expect(screen.queryByText('Signal')).not.toBeInTheDocument()

    // Project is where the page lands.
    expect(screen.getByTestId('body-project')).toBeInTheDocument()
    expect(screen.queryByTestId('body-tasks')).not.toBeInTheDocument()
  })

  it('Project tab badge equals the sum of firing signal counts and disappears at zero', () => {
    // stalled 3 + high-stakes 1 + stale PRs 2 + overdue 4 — the badge is the
    // sum of exactly the pills the health row shows.
    const { unmount } = setup(
      makeStats(
        {
          stalledTaskIds: [stalled('1'), stalled('2'), stalled('3')],
          highStakesTaskIds: [stalled('1')],
          staleOpenPrs: [
            { number: 1, openedAt: daysAgo(6), url: 'https://x/1' },
            { number: 2, openedAt: daysAgo(7), url: 'https://x/2' },
          ],
        },
        { overdueTasks: { count: 4, taskIds: ['a', 'b', 'c', 'd'] } }
      )
    )
    expect(screen.getByTestId('project-tab-badge')).toHaveTextContent('10')
    unmount()

    // A healthy project carries no ornament at all.
    setup(makeStats())
    expect(screen.queryByTestId('project-tab-badge')).not.toBeInTheDocument()
  })

  it('does not badge a project whose stats have not arrived', () => {
    setup(null)
    expect(screen.queryByTestId('project-tab-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('body-project')).toBeInTheDocument()
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
