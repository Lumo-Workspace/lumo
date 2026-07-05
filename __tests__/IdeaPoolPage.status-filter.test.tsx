/** @jest-environment jsdom */

// react-intl → id-as-message with value interpolation appended (mirrors the
// sibling IdeaPoolPage suites), so status labels render as their message id.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? `${id} ${Object.values(values).join(' ')}` : id),
    formatDate: (d: Date) => `date:${d.getUTCFullYear()}`,
  }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const mockUseIdeas = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeas', () => ({
  useIdeas: () => mockUseIdeas(),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/usePlanRuns', () => ({
  usePlanRuns: () => ({
    runs: [],
    loading: false,
    error: null,
    refetch: jest.fn(),
  }),
}))

// No clustering → flat time-ordered list; keeps the assertions about which rows
// render independent of the grouping surface (LUM-677).
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeaGrouping', () => ({
  useIdeaGrouping: () => ({ clustering: null, loading: false, error: null }),
}))

// The detail slide-over's edit mutation (LUM-683) — stubbed; this suite covers
// the pool listing's status filter, not the drawer.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useUpdateIdea', () => ({
  useUpdateIdea: () => ({
    updateStatement: jest.fn(),
    saving: false,
    error: null,
  }),
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { IdeaPoolPage } from '@/app/workspace/[workspaceUrl]/components/pages/IdeaPoolPage'
import type { ApiIdea } from '@/app/workspace/[workspaceUrl]/types'

const base: ApiIdea = {
  id: 'i0',
  number: 0,
  identifier: 'LUM-I0',
  statement: '',
  status: 'CAPTURED',
  sourceContext: null,
  sourceSessionId: null,
  sourceTaskId: null,
  proposedByMemberId: 'm1',
  createdAt: '2026-07-04T10:00:00.000Z',
  planRunId: null,
  initiative: null,
}

const captured: ApiIdea = {
  ...base,
  id: 'i1',
  number: 1,
  identifier: 'LUM-I1',
  statement: 'captured idea',
  status: 'CAPTURED',
}
const developing: ApiIdea = {
  ...base,
  id: 'i2',
  number: 2,
  identifier: 'LUM-I2',
  statement: 'developing idea',
  status: 'DEVELOPING',
}
const plannedIdea: ApiIdea = {
  ...base,
  id: 'i3',
  number: 3,
  identifier: 'LUM-I3',
  statement: 'planned idea',
  status: 'PLANNED',
}
const dropped: ApiIdea = {
  ...base,
  id: 'i4',
  number: 4,
  identifier: 'LUM-I4',
  statement: 'dropped idea',
  status: 'DROPPED',
}

function setIdeas(ideas: ApiIdea[]) {
  mockUseIdeas.mockReturnValue({
    ideas,
    loading: false,
    error: null,
    refetch: jest.fn(),
  })
}

beforeEach(() => jest.clearAllMocks())

describe('idea pool status filter', () => {
  const ALL = [captured, developing, plannedIdea, dropped]

  it('offers a filter toggle for every one of the four statuses', () => {
    setIdeas(ALL)
    render(<IdeaPoolPage workspaceUrl='lumo' />)
    for (const status of ['CAPTURED', 'DEVELOPING', 'PLANNED', 'DROPPED']) {
      expect(
        screen.getByTestId(`idea-status-toggle-${status}`)
      ).toBeInTheDocument()
    }
  })

  it('renders a distinct badge label on each of the four status rows', () => {
    setIdeas(ALL)
    render(<IdeaPoolPage workspaceUrl='lumo' />)
    // Turn DROPPED on so all four rows render, then read each row's badge.
    fireEvent.click(screen.getByTestId('idea-status-toggle-DROPPED'))

    const rows = screen.getAllByTestId('idea-row')
    const statuses = rows.map(r => r.getAttribute('data-status'))
    expect(new Set(statuses)).toEqual(
      new Set(['CAPTURED', 'DEVELOPING', 'PLANNED', 'DROPPED'])
    )

    // Each row's Badge shows that status's own label — all four are distinct.
    const badgeOf = (status: string) => {
      const row = rows.find(r => r.getAttribute('data-status') === status)!
      return within(row).getByText(
        {
          CAPTURED: 'ideas.statusCaptured',
          DEVELOPING: 'ideas.statusDeveloping',
          PLANNED: 'ideas.statusPlanned',
          DROPPED: 'ideas.statusDropped',
        }[status] as string
      )
    }
    for (const s of ['CAPTURED', 'DEVELOPING', 'PLANNED', 'DROPPED']) {
      expect(badgeOf(s)).toBeInTheDocument()
    }
  })

  it('hides DROPPED ideas by default', () => {
    setIdeas(ALL)
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    expect(screen.getByText('captured idea')).toBeInTheDocument()
    expect(screen.getByText('developing idea')).toBeInTheDocument()
    expect(screen.getByText('planned idea')).toBeInTheDocument()
    // DROPPED is off by default — its row is not rendered.
    expect(screen.queryByText('dropped idea')).not.toBeInTheDocument()
  })

  it('reveals DROPPED ideas once the DROPPED filter is toggled on', () => {
    setIdeas(ALL)
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    expect(screen.queryByText('dropped idea')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('idea-status-toggle-DROPPED'))
    expect(screen.getByText('dropped idea')).toBeInTheDocument()
  })

  it('hides a status when its (default-on) filter is toggled off', () => {
    setIdeas(ALL)
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    expect(screen.getByText('captured idea')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('idea-status-toggle-CAPTURED'))
    expect(screen.queryByText('captured idea')).not.toBeInTheDocument()
    // Other statuses stay visible.
    expect(screen.getByText('developing idea')).toBeInTheDocument()
  })

  it('shows a filter-specific empty message when the filter hides everything', () => {
    setIdeas([dropped])
    render(<IdeaPoolPage workspaceUrl='lumo' />)
    // Only a DROPPED idea exists and DROPPED is hidden by default.
    expect(screen.queryByText('dropped idea')).not.toBeInTheDocument()
    expect(screen.getByText('ideas.noneForFilter')).toBeInTheDocument()
  })
})
