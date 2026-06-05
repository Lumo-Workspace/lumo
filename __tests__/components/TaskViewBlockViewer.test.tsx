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
jest.mock(
  '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks',
  () => ({ useWorkspaceTasks: (...a: unknown[]) => mockUseWorkspaceTasks(...a) })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/hooks/useProjects',
  () => ({ useProjects: () => ({ projects: [] }) })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones',
  () => ({ useWorkspaceMilestones: () => ({ milestones: [] }) })
)

import { render, screen, waitFor } from '@testing-library/react'
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
    const link = await waitFor(() => screen.getByRole('link', { name: /Fix login/ }))
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
        { id: 't1', title: 'A', teamIdentifier: 'LUM', number: 1, status: 'TODO' },
        { id: 't2', title: 'B', teamIdentifier: 'LUM', number: 2, status: 'DONE' },
      ],
      truncated: false,
      loading: false,
      error: null,
    })
    const stored =
      '<div data-task-view data-task-view-config=\'{"version":1,"view":"list","groupBy":"status","filters":{}}\'></div>'
    render(<RichTextViewer value={stored} />)
    await waitFor(() => expect(screen.getByText(/Todo/)).toBeInTheDocument())
    expect(screen.getByText(/Done/)).toBeInTheDocument()
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
})
