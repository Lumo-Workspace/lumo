/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { TaskListByMilestone } from '@/app/workspace/[workspaceUrl]/components/milestones/TaskListByMilestone'

// Repo convention: mock react-intl and resolve ids through the real en.json so
// assertions read against real English strings. StatusIcon's aria-labels also
// flow through this mock.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      descriptor: { id: string },
      values?: Record<string, unknown>
    ) => {
      const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
        string,
        string
      >
      const template = messages[descriptor.id] ?? descriptor.id
      return values
        ? template.replace(/\{(\w+)\}/g, (_m, k) =>
            k in values ? String(values[k]) : `{${k}}`
          )
        : template
    },
  }),
}))

// Data fetching is exercised elsewhere; here we drive the render off useQuery's
// return value directly so the test stays focused on row presentation.
jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }))

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'lumo', projectSlug: 'lumo' }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

// Avoid pulling the real api-client (fetch wrappers) into the jsdom run.
jest.mock('@/lib/api-client', () => ({ tasksClient: { listByProject: jest.fn() } }))

const mockUseQuery = useQuery as jest.MockedFunction<typeof useQuery>

function mockTasks(tasks: unknown[]) {
  mockUseQuery.mockReturnValue({ data: tasks, isLoading: false } as never)
}

describe('TaskListByMilestone', () => {
  afterEach(() => mockUseQuery.mockReset())

  it('renders a status icon, identifier and title per task', () => {
    mockTasks([
      { id: '1', identifier: 'LUM-168', title: 'Risk indicator', status: 'DONE' },
      { id: '2', identifier: 'LUM-172', title: 'Task dependencies', status: 'TODO' },
    ])
    render(<TaskListByMilestone projectId="p1" milestoneId="m1" />)

    expect(screen.getByText('LUM-168')).toBeInTheDocument()
    expect(screen.getByText('Risk indicator')).toBeInTheDocument()
    expect(screen.getByText('Task dependencies')).toBeInTheDocument()
    // StatusIcon carries an aria-label per status — this is the visual
    // distinction the gray-only text label used to lack.
    expect(screen.getByLabelText('Done')).toBeInTheDocument()
    expect(screen.getByLabelText('Todo')).toBeInTheDocument()
  })

  it('renders the empty state when the milestone has no tasks', () => {
    mockTasks([])
    render(<TaskListByMilestone projectId="p1" milestoneId="m1" />)
    expect(
      screen.getByText('No tasks in this milestone yet')
    ).toBeInTheDocument()
  })

  it('shows a busy placeholder while loading', () => {
    mockUseQuery.mockReturnValue({ data: [], isLoading: true } as never)
    const { container } = render(
      <TaskListByMilestone projectId="p1" milestoneId="m1" />
    )
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })
})
