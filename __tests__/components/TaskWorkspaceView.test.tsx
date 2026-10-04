/** @jest-environment jsdom */

// Mock the heavy presentational children so we can assert how
// TaskWorkspaceView wires the new milestone-vs-sprint differences without
// pulling in dnd-kit / virtualization / the real table.
jest.mock('@/app/workspace/[workspaceUrl]/components/board/BoardView', () => ({
  BoardView: ({ onAddTask }: { onAddTask?: (id: string) => void }) => (
    <div data-testid='board' data-has-add={onAddTask ? '1' : '0'} />
  ),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/board/SortableTaskCard',
  () => ({ MyTaskCard: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/task-list/TaskListView',
  () => ({ TaskListView: () => <div data-testid='list' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/task-list/TaskListToolbar',
  () => ({
    TaskListToolbar: (p: {
      sidebarExpandLabel?: string
      sidebarCollapseLabel?: string
    }) => (
      <div
        data-testid='toolbar'
        data-expand={p.sidebarExpandLabel ?? ''}
        data-collapse={p.sidebarCollapseLabel ?? ''}
      />
    ),
  })
)
// The filter controls pull in react-intl (untranspiled ESM under jest); their
// own suites cover them, so stub them out here.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/task-list/TaskFilterMenu',
  () => ({ TaskFilterMenu: () => <div data-testid='filter-menu' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/task-list/TaskFilterChips',
  () => ({ TaskFilterChips: () => <div data-testid='filter-chips' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/task-list/BulkActionBar',
  () => ({ BulkActionBar: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/task-list/BulkDeleteConfirm',
  () => ({ BulkDeleteConfirm: () => null })
)
jest.mock('@/app/workspace/[workspaceUrl]/components/AsyncContent', () => ({
  AsyncContent: ({
    empty,
    emptyState,
    children,
  }: {
    empty: boolean
    emptyState: React.ReactNode
    children: React.ReactNode
  }) => <div>{empty ? emptyState : children}</div>,
}))

// Isolate the view's JSX wiring from the data/DnD hooks (and their ESM deps).
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))
jest.mock('@/lib/api-client', () => ({
  tasksClient: { update: jest.fn(), delete: jest.fn() },
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskBulkMutations', () => ({
  useTaskBulkMutations: () => ({
    confirmDeleteOpen: false,
    setConfirmDeleteOpen: () => {},
    deleting: false,
    runBulkUpdate: () => {},
    runBulkDelete: () => {},
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoardDrag', () => ({
  useBoardDrag: () => ({
    activeId: null,
    onDragStart: () => {},
    onDragOver: () => {},
    onDragEnd: () => {},
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoardSensors', () => ({
  useBoardSensors: () => [],
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useDisplayOptions', () => ({
  useDisplayOptions: () => ({
    options: { completedFilter: 'all', ordering: 'manual' },
    setCompletedFilter: () => {},
    setOrdering: () => {},
  }),
}))

import { render, screen } from '@testing-library/react'
import { TaskWorkspaceView } from '@/app/workspace/[workspaceUrl]/components/task-list/TaskWorkspaceView'

const base = {
  tasks: [],
  setTasks: () => {},
  loading: false,
  error: null,
  onRetry: () => {},
  onTaskClick: () => {},
  members: [],
  projects: [],
  displayOptionsKey: 'lumo:display:test',
  sidebarCollapsed: false,
  onToggleSidebar: () => {},
  emptyState: <div data-testid='empty'>nothing here</div>,
}

test('omitting onNewTask hides the board add-task affordance (milestone board)', () => {
  render(<TaskWorkspaceView {...base} />)
  expect(screen.getByTestId('board').getAttribute('data-has-add')).toBe('0')
})

test('providing onNewTask enables the board add-task affordance (sprint board)', () => {
  render(<TaskWorkspaceView {...base} onNewTask={() => {}} />)
  expect(screen.getByTestId('board').getAttribute('data-has-add')).toBe('1')
})

test('forwards scope-specific sidebar toggle labels to the toolbar', () => {
  render(
    <TaskWorkspaceView
      {...base}
      sidebarExpandLabel='Show milestone details'
      sidebarCollapseLabel='Hide milestone details'
    />
  )
  const toolbar = screen.getByTestId('toolbar')
  expect(toolbar.getAttribute('data-expand')).toBe('Show milestone details')
  expect(toolbar.getAttribute('data-collapse')).toBe('Hide milestone details')
})

test('renders the caller-supplied empty state in list view when there are no tasks', () => {
  render(<TaskWorkspaceView {...base} defaultViewMode='list' />)
  expect(screen.getByTestId('empty')).toBeTruthy()
})
