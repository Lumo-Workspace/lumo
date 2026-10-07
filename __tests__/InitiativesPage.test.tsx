/** @jest-environment jsdom */
/**
 * LUM-673: the initiatives web page lists initiatives, offers a New Initiative
 * create action, and the detail page renders the goal, assumption, status and
 * attached tasks with the id shown as LUM-INIT-<n>.
 */
const messages: Record<string, string> = {
  'sidebar.initiatives': 'Initiatives',
  'initiative.new': 'New initiative',
  'initiative.status.active': 'Active',
  'initiative.status.done': 'Done',
  'initiative.list.loading': 'Loading…',
  'initiative.list.error': 'Could not load',
  'initiative.list.empty': 'No initiatives yet',
  'initiative.list.emptyHint': 'Create one directly.',
  'initiative.list.taskCount': '{count} tasks',
  'initiative.create.goalLabel': 'Goal',
  'initiative.create.goalPlaceholder': 'What is the goal?',
  'initiative.create.assumptionLabel': 'The bet (optional)',
  'initiative.create.assumptionPlaceholder': 'What are you betting on?',
  'initiative.create.submit': 'Create initiative',
  'initiative.create.submitting': 'Creating…',
  'initiative.create.cancel': 'Cancel',
  'initiative.create.error': 'Could not create',
  'initiative.detail.bet': 'The bet',
  'initiative.detail.attachedTasks': 'Attached tasks',
  'initiative.detail.progress': '{done}/{total} done',
  'initiative.detail.noTasks': 'No tasks',
  'initiative.detail.backToList': 'Back',
  'initiative.detail.notFound': 'Initiative not found',
  'initiative.task.todo': 'To do',
  'initiative.task.done': 'Done',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
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

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme', initiativeId: 'init-1' }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({
    title,
    actions,
  }: {
    title: string
    actions?: React.ReactNode
  }) => (
    <div>
      <span>{title}</span>
      {actions}
    </div>
  ),
}))

const mockUseInitiatives = jest.fn()
const mockCreateInitiative = jest.fn()
const mockUseInitiativeDetail = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useInitiatives', () => ({
  useInitiatives: () => mockUseInitiatives(),
  useCreateInitiative: () => ({
    createInitiative: mockCreateInitiative,
    isCreating: false,
    error: null,
  }),
  useInitiativeDetail: (...args: unknown[]) => mockUseInitiativeDetail(...args),
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InitiativesLandingClient } from '@/app/workspace/[workspaceUrl]/initiatives/components/InitiativesLandingClient'
import { InitiativeDetailPage } from '@/app/workspace/[workspaceUrl]/components/pages/InitiativeDetailPage'

beforeEach(() => jest.clearAllMocks())

describe('Initiatives list page + New Initiative create action', () => {
  beforeEach(() => {
    mockUseInitiatives.mockReturnValue({
      initiatives: [
        {
          id: 'init-2',
          identifier: 'LUM-INIT-2',
          name: 'Ship the converter',
          status: 'ACTIVE',
          taskCount: 3,
        },
      ],
      isLoading: false,
      error: null,
    })
  })

  it('lists the team initiatives with their LUM-INIT-<n> ids', () => {
    render(<InitiativesLandingClient />)
    expect(screen.getByText('LUM-INIT-2')).toBeInTheDocument()
    expect(screen.getByText('Ship the converter')).toBeInTheDocument()
  })

  it('opens the New Initiative form and creates directly', async () => {
    mockCreateInitiative.mockResolvedValue({})
    render(<InitiativesLandingClient />)

    // The create action is present, and the form is hidden until clicked.
    const newBtn = screen.getByRole('button', { name: /New initiative/ })
    expect(screen.queryByLabelText('Goal')).not.toBeInTheDocument()
    fireEvent.click(newBtn)

    fireEvent.change(screen.getByLabelText('Goal'), {
      target: { value: 'Adopt trunk-based dev' },
    })
    fireEvent.change(screen.getByLabelText('The bet (optional)'), {
      target: { value: 'faster review cycles' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create initiative' }))

    await waitFor(() =>
      expect(mockCreateInitiative).toHaveBeenCalledWith({
        name: 'Adopt trunk-based dev',
        assumptionNote: 'faster review cycles',
      })
    )
  })
})

describe('Initiative detail page', () => {
  it('shows goal, bet, status and attached tasks with LUM-INIT-<n>', () => {
    mockUseInitiativeDetail.mockReturnValue({
      initiative: {
        id: 'init-1',
        number: 3,
        identifier: 'LUM-INIT-3',
        name: 'Ship the design-thinking converter',
        assumptionNote: 'Teams will curate the pool weekly',
        status: 'ACTIVE',
        createdAt: '1970-01-01T00:00:00.000Z',
        tasks: [
          {
            id: 't7',
            identifier: 'LUM-7',
            title: 'Build the API',
            status: 'DONE',
          },
        ],
        taskProgress: { total: 1, done: 1 },
      },
      isLoading: false,
      error: null,
    })

    render(<InitiativeDetailPage />)
    expect(screen.getAllByText('LUM-INIT-3').length).toBeGreaterThan(0)
    expect(
      screen.getByText('Ship the design-thinking converter')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Teams will curate the pool weekly')
    ).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('LUM-7')).toBeInTheDocument()
    expect(screen.getByText('Build the API')).toBeInTheDocument()
  })
})
