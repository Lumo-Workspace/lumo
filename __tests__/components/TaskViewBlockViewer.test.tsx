// __tests__/components/TaskViewBlockViewer.test.tsx
/** @jest-environment jsdom */

// NodeViews import react-intl (untranspiled ESM); stub it.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      defaultMessage,
      id,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))

const mockUseWorkspaceTasks = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks', () => ({
  useWorkspaceTasks: (...a: unknown[]) => mockUseWorkspaceTasks(...a),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useProjects', () => ({
  useProjects: () => ({ projects: [] }),
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones',
  () => ({ useWorkspaceMilestones: () => ({ milestones: [] }) })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskStatus',
  () => ({
    useWorkspaceTaskStatus: () => ({ updateStatus: jest.fn() }),
  })
)

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    isDragging: false,
  }),
  PointerSensor: class PointerSensor {},
  useSensor: jest.fn(),
  useSensors: jest.fn(() => []),
}))

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { RichTextViewer } from '@/app/workspace/[workspaceUrl]/components/RichTextViewer'

const STORED =
  '<div data-task-view data-task-view-config=\'{"version":1,"view":"list","groupBy":"none","filters":{}}\'></div>'

beforeEach(() => jest.clearAllMocks())

describe('RichTextViewer — task view block', () => {
  it('renders the loading state', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [],
      truncated: false,
      loading: true,
      error: null,
    })
    render(<RichTextViewer value={STORED} />)
    await waitFor(() =>
      expect(screen.getByText('Loading tasks…')).toBeInTheDocument()
    )
  })

  it('renders the empty state', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [],
      truncated: false,
      loading: false,
      error: null,
    })
    render(<RichTextViewer value={STORED} />)
    await waitFor(() =>
      expect(
        screen.getByText('No tasks match these filters.')
      ).toBeInTheDocument()
    )
  })

  it('renders rows that link to the task detail', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [
        { id: 't1', title: 'Fix login', teamIdentifier: 'LUM', number: 42 },
      ],
      truncated: false,
      loading: false,
      error: null,
    })
    render(<RichTextViewer value={STORED} />)
    const link = await waitFor(() =>
      screen.getByRole('link', { name: /Fix login/ })
    )
    expect(link).toHaveAttribute('href', '/workspace/acme/my-tasks/LUM-42')
  })

  it('renders the error state', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [],
      truncated: false,
      loading: false,
      error: 'boom',
    })
    render(<RichTextViewer value={STORED} />)
    await waitFor(() =>
      expect(screen.getByText('Could not load tasks.')).toBeInTheDocument()
    )
  })

  it('renders status group headers when groupBy is status', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [
        {
          id: 't1',
          title: 'A',
          teamIdentifier: 'LUM',
          number: 1,
          status: 'TODO',
        },
        {
          id: 't2',
          title: 'B',
          teamIdentifier: 'LUM',
          number: 2,
          status: 'DONE',
        },
      ],
      truncated: false,
      loading: false,
      error: null,
    })
    const stored =
      '<div data-task-view data-task-view-config=\'{"version":1,"view":"list","groupBy":"status","filters":{}}\'></div>'
    render(<RichTextViewer value={stored} />)
    await waitFor(() =>
      expect(screen.getByText(/status\.todo/)).toBeInTheDocument()
    )
    expect(screen.getByText(/status\.done/)).toBeInTheDocument()
  })

  it('does not render the configure panel in the read-only viewer', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [],
      truncated: false,
      loading: false,
      error: null,
    })
    render(<RichTextViewer value={STORED} />)
    // Wait for the NodeView portal to mount, then assert the editing UI is absent.
    await waitFor(() =>
      expect(
        screen.getByText('No tasks match these filters.')
      ).toBeInTheDocument()
    )
    expect(
      screen.queryByRole('button', { name: /Configure task view/ })
    ).not.toBeInTheDocument()
  })

  it('renders the kanban board when view is kanban', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [
        {
          id: 't1',
          title: 'Alpha',
          teamIdentifier: 'LUM',
          number: 1,
          status: 'TODO',
        },
      ],
      truncated: false,
      loading: false,
      error: null,
    })
    const stored =
      '<div data-task-view data-task-view-config=\'{"version":1,"view":"kanban","groupBy":"none","filters":{}}\'></div>'
    render(<RichTextViewer value={stored} />)
    await waitFor(() =>
      expect(screen.getByText('status.inProgress')).toBeInTheDocument()
    )
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('shows the truncated banner when the result is capped', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [
        {
          id: 't1',
          title: 'A',
          teamIdentifier: 'LUM',
          number: 1,
          status: 'TODO',
        },
      ],
      truncated: true,
      loading: false,
      error: null,
    })
    render(<RichTextViewer value={STORED} />)
    await waitFor(() =>
      expect(screen.getByText(/Showing the first/)).toBeInTheDocument()
    )
  })

  it('refetches when the refresh button is clicked', async () => {
    const refetch = jest.fn()
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [],
      truncated: false,
      loading: false,
      error: null,
      refetch,
    })
    render(<RichTextViewer value={STORED} />)
    const btn = await waitFor(() =>
      screen.getByRole('button', { name: 'Refresh' })
    )
    fireEvent.click(btn)
    expect(refetch).toHaveBeenCalled()
  })
})
