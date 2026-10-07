/** @jest-environment jsdom */
/**
 * LUM-673: the initiative detail page renders the goal statement, the
 * assumption note (bet), status and the attached tasks,
 * with the initiative id shown as LUM-INIT-<n>.
 */
const messages: Record<string, string> = {
  'sidebar.initiatives': 'Initiatives',
  'initiative.status.active': 'Active',
  'initiative.detail.bet': 'The bet',
  'initiative.detail.attachedTasks': 'Attached tasks',
  'initiative.detail.progress': '{done}/{total} done',
  'initiative.detail.noTasks': 'No tasks yet',
  'initiative.detail.backToList': 'Back to initiatives',
  'initiative.detail.loading': 'Loading…',
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

// Header chrome pulls in the shadcn Sidebar context — stub it out.
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({ title }: { title: string }) => <div>{title}</div>,
}))

const mockUseInitiativeDetail = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useInitiatives', () => ({
  useInitiativeDetail: (...args: unknown[]) => mockUseInitiativeDetail(...args),
}))

import { render, screen } from '@testing-library/react'
import { InitiativeDetailPage } from '@/app/workspace/[workspaceUrl]/components/pages/InitiativeDetailPage'

const DETAIL = {
  id: 'init-1',
  number: 3,
  identifier: 'LUM-INIT-3',
  name: 'Ship the design-thinking converter',
  assumptionNote: 'Bet: teams will curate the idea pool weekly',
  status: 'ACTIVE' as const,
  createdAt: '1970-01-01T00:00:00.000Z',
  tasks: [
    {
      id: 't7',
      identifier: 'LUM-7',
      title: 'Build the initiatives API',
      status: 'DONE' as const,
    },
    {
      id: 't8',
      identifier: 'LUM-8',
      title: 'Build the initiatives page',
      status: 'TODO' as const,
    },
  ],
  taskProgress: { total: 2, done: 1 },
}

describe('InitiativeDetailPage', () => {
  it('renders goal, bet, status, attached tasks, and the LUM-INIT-<n> id', () => {
    mockUseInitiativeDetail.mockReturnValue({
      initiative: DETAIL,
      isLoading: false,
      error: null,
    })

    render(<InitiativeDetailPage />)

    // Read from the route id.
    expect(mockUseInitiativeDetail).toHaveBeenCalledWith('init-1')

    // Id shown as LUM-INIT-<n>.
    expect(screen.getAllByText('LUM-INIT-3').length).toBeGreaterThan(0)
    // Goal statement + status.
    expect(
      screen.getByText('Ship the design-thinking converter')
    ).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    // The bet (assumption note).
    expect(
      screen.getByText('Bet: teams will curate the idea pool weekly')
    ).toBeInTheDocument()
    // No consumed-ideas section any more (LUM-1040).
    expect(screen.queryByText('Consumed ideas')).not.toBeInTheDocument()
    // Attached tasks + progress.
    expect(screen.getByText('LUM-7')).toBeInTheDocument()
    expect(screen.getByText('Build the initiatives API')).toBeInTheDocument()
    expect(screen.getByText('Build the initiatives page')).toBeInTheDocument()
    expect(screen.getByText('1/2 done')).toBeInTheDocument()
  })

  it('renders a not-found state when the initiative is missing', () => {
    mockUseInitiativeDetail.mockReturnValue({
      initiative: null,
      isLoading: false,
      error: null,
    })

    render(<InitiativeDetailPage />)
    expect(screen.getByText('Initiative not found')).toBeInTheDocument()
  })
})
