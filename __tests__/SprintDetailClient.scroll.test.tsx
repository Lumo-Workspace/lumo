/** @jest-environment jsdom */

// The sprint info block above the board (stat cards + Team performance) grows
// unbounded — Team performance expands per member and again per task — so the
// detail body must scroll instead of clipping it. Before LUM-703 the body was
// `overflow-hidden`, which made everything past the fold (the rest of the
// table AND the whole board) unreachable.

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
  IntlProvider: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ workspaceUrl: 'test-workspace', sprintId: '1' }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

// The board, the stat cards and the Team performance table are covered by
// their own tests; here they are stubs so the assertion is purely about the
// scroll container the page composes around them.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/task-list/TaskWorkspaceView',
  () => ({
    TaskWorkspaceView: () => <div data-testid='workspace' />,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/sprints/components/SprintStatCards',
  () => ({
    SprintStatCards: () => <div data-testid='stat-cards' />,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/sprints/components/SprintTeamPerformance',
  () => ({
    SprintTeamPerformance: () => <div data-testid='team-performance' />,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/sprints/components/SprintActionsMenu',
  () => ({
    SprintActionsMenu: () => <div data-testid='actions' />,
  })
)

// Every mocked hook returns a frozen module-level value. Handing back a fresh
// `[]` / `{}` per call would change identity on every render, and the page's
// `useEffect(… , [tasks])` → `setLocalTasks` would then loop forever (it does:
// the run OOMs V8 rather than failing).
// (`mock`-prefixed so jest's factory hoisting allows the reference.)
const mockEmpty: never[] = []
const mockNoop = () => {}
const mockSprintResult = {
  sprint: { id: 'sprint_1', teamId: 'team_1', name: 'Sprint 1', number: 1 },
  progress: { done: 0, total: 0 },
  risk: null,
  isLoading: false,
  error: null,
  refetch: mockNoop,
}
const mockTasksResult = { tasks: mockEmpty, refetch: mockNoop }
const mockMembersResult = { members: mockEmpty }
const mockProjectsResult = { projects: mockEmpty, fetchProjects: mockNoop }

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintByNumber: () => mockSprintResult,
  useSprintTasks: () => mockTasksResult,
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMembers', () => ({
  useMembers: () => mockMembersResult,
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useProjects', () => ({
  useProjects: () => mockProjectsResult,
}))

import { render } from '@testing-library/react'
import { SprintDetailClient } from '@/app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient'

test('sprint detail body scrolls vertically instead of clipping a tall info block', () => {
  const { container } = render(<SprintDetailClient />)
  const body = container.querySelector('div.flex-1.min-h-0')!
  expect(body.className).toContain('overflow-y-auto')
  expect(body.className).not.toContain('overflow-hidden')
})

test('sprint detail board keeps a usable height floor once the page scrolls', () => {
  // `flex-1` alone collapses to nothing inside a scrolling column when the
  // info block eats the height, so the board needs an explicit floor.
  const { getByTestId } = render(<SprintDetailClient />)
  const boardWrapper = getByTestId('workspace').parentElement!
  expect(boardWrapper.className).toContain('min-h-[480px]')
  expect(boardWrapper.className).toContain('flex-1')
})
