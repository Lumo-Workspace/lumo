/** @jest-environment jsdom */
import '@testing-library/jest-dom'

// LUM-718 folds the sprint info (header card + members section) off the top of
// the board and into a collapsible right rail, driven by a toggle that sits
// immediately right of the board/list switch. Before this the info sat above
// the board and the whole page had to scroll (LUM-703) to keep a tall members
// table reachable; the rail scrolls on its own instead, so the board keeps the
// viewport.

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en-US',
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

// The board and the rail's two sections have their own tests; here they are
// stubs so the assertions are purely about the shell the page composes. The
// workspace stub surfaces the rail props it was handed — that wiring (does the
// sprint page give the toolbar a working toggle?) is what this file owns; where
// the toolbar *places* that toggle is asserted against the real toolbar below.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/task-list/TaskWorkspaceView',
  () => ({
    TaskWorkspaceView: ({
      sidebarCollapsed,
      onToggleSidebar,
    }: {
      sidebarCollapsed?: boolean
      onToggleSidebar?: () => void
    }) => (
      <div data-testid='workspace'>
        <span data-testid='rail-collapsed'>{String(sidebarCollapsed)}</span>
        <button
          type='button'
          data-testid='rail-toggle'
          onClick={() => onToggleSidebar?.()}
        />
      </div>
    ),
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/sprints/components/SprintHeader',
  () => ({
    SprintHeader: () => <div data-testid='sprint-header' />,
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

// The toolbar's own leaves: the display menu is a Radix dropdown (nothing here
// asserts it), while ViewToggle stays real — it is one half of the ordering
// claim.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/DisplayOptionsMenu',
  () => ({
    DisplayOptionsMenu: () => <div data-testid='display-options' />,
  })
)

import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SprintDetailClient } from '@/app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient'
import { TaskListToolbar } from '@/app/workspace/[workspaceUrl]/components/task-list/TaskListToolbar'
import { CACHE_KEY } from '@/app/workspace/[workspaceUrl]/constants'

beforeEach(() => localStorage.clear())

test('folds the sprint info into a collapsible right rail', () => {
  const { container } = render(<SprintDetailClient />)

  // Both info sections live in the rail, not above the board.
  const aside = container.querySelector('aside')!
  expect(aside).toContainElement(screen.getByTestId('sprint-header'))
  expect(aside).toContainElement(screen.getByTestId('team-performance'))

  // Two columns pinned to the viewport — the rail scrolls itself, so the page
  // body no longer has to scroll as a whole.
  const body = container.querySelector('div.flex-1.min-h-0')!
  expect(body.className).toContain('lg:grid')
  expect(body.className).toContain('lg:overflow-hidden')

  // Collapsing takes the whole rail out, board included in the reclaimed width.
  fireEvent.click(screen.getByTestId('rail-toggle'))
  expect(screen.queryByTestId('sprint-header')).not.toBeInTheDocument()
  expect(screen.queryByTestId('team-performance')).not.toBeInTheDocument()
  expect(container.querySelector('aside')).toBeNull()
})

test('puts the rail toggle right after the view toggle and remembers the collapsed preference', () => {
  // Placement: in the toolbar's right-hand control group the collapse button is
  // the element straight after the board/list switch.
  const { container: toolbar } = render(
    <TaskListToolbar
      completedFilter='all'
      onCompletedFilterChange={() => {}}
      ordering='manual'
      onOrderingChange={() => {}}
      showSubtasks={false}
      onShowSubtasksChange={() => {}}
      viewMode='board'
      onViewModeChange={() => {}}
      sidebarCollapsed={false}
      onToggleSidebar={() => {}}
    />
  )
  const viewToggle = screen
    .getByLabelText('common.viewBoard')
    .closest('div.inline-flex')!
  const collapseButton = screen.getByLabelText('Hide sprint details')
  expect(viewToggle.nextElementSibling).toBe(collapseButton)
  // …and that group is the toolbar's trailing one.
  expect(collapseButton.parentElement).toBe(
    toolbar.querySelector('div.h-12')!.lastElementChild
  )
  cleanup()

  // Persistence: the sprint page writes the preference and reads it back on a
  // fresh mount, so the rail state survives navigation.
  const first = render(<SprintDetailClient />)
  expect(screen.getByTestId('rail-collapsed')).toHaveTextContent('false')
  fireEvent.click(screen.getByTestId('rail-toggle'))
  expect(screen.getByTestId('rail-collapsed')).toHaveTextContent('true')
  expect(localStorage.getItem(CACHE_KEY.sprintSidebarCollapsed)).toContain(
    'true'
  )
  first.unmount()

  render(<SprintDetailClient />)
  expect(screen.getByTestId('rail-collapsed')).toHaveTextContent('true')
})
