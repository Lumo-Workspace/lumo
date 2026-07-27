/** @jest-environment jsdom */

// react-intl → id-as-message with value interpolation appended, and a
// deterministic date formatter so we can assert the captured time renders.
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

// This suite focuses on the idea pool; the plan-runs surface (LUM-677) has its
// own suite, so stub it to an empty pool (the section renders nothing then).
jest.mock('@/app/workspace/[workspaceUrl]/hooks/usePlanRuns', () => ({
  usePlanRuns: () => ({
    runs: [],
    loading: false,
    error: null,
    refetch: jest.fn(),
  }),
}))

// No clustering here → the flat time-ordered list (the grouped view has its own
// suite). LUM-677.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeaGrouping', () => ({
  useIdeaGrouping: () => ({ clustering: null, loading: false, error: null }),
}))

// PageBreadcrumb pulls in SidebarTrigger -> useSidebar, which needs a
// SidebarProvider ancestor; the repo's other page suites stub it the same way.
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({
    title,
    children,
  }: {
    title?: string
    children?: React.ReactNode
  }) => <div>{title ?? children}</div>,
}))

// The detail slide-over's edit mutation (LUM-683) — stubbed; this suite covers
// the pool listing, not the drawer.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useUpdateIdea', () => ({
  useUpdateIdea: () => ({
    updateStatement: jest.fn(),
    saving: false,
    error: null,
  }),
}))

// The pool's own mutations (LUM-708) — stubbed; each has its own suite.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useCaptureIdea', () => ({
  useCaptureIdea: () => ({
    capture: jest.fn().mockResolvedValue(undefined),
    capturing: false,
    error: null,
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useUpdateIdeaStatus', () => ({
  useUpdateIdeaStatus: () => ({
    updateStatus: jest.fn().mockResolvedValue(undefined),
    updating: false,
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

const planned: ApiIdea = {
  ...base,
  id: 'i3',
  number: 3,
  identifier: 'LUM-I3',
  statement: 'ship the idea pool',
  status: 'PLANNED',
  planRunId: 'run-1',
  initiative: { id: 'init-1', number: 5, name: 'Idea visibility' },
}

const capturedWithContext: ApiIdea = {
  ...base,
  id: 'i2',
  number: 2,
  identifier: 'LUM-I2',
  statement: 'dark mode toggle',
  sourceContext: 'from the standup',
}

const capturedFromTask: ApiIdea = {
  ...base,
  id: 'i1',
  number: 1,
  identifier: 'LUM-I1',
  statement: 'faster search',
  sourceTaskId: 'LUM-9',
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

describe('IdeaPoolPage', () => {
  it('renders each idea with id, statement, status and captured time', () => {
    setIdeas([planned, capturedWithContext, capturedFromTask])
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    // statements
    expect(screen.getByText('ship the idea pool')).toBeInTheDocument()
    expect(screen.getByText('dark mode toggle')).toBeInTheDocument()
    expect(screen.getByText('faster search')).toBeInTheDocument()

    // ids
    expect(screen.getByText('LUM-I3')).toBeInTheDocument()
    expect(screen.getByText('LUM-I2')).toBeInTheDocument()

    // status labels (both kinds present) — scoped to the idea rows so the
    // per-status filter chips (which also render every label) don't count.
    const rows = screen.getAllByTestId('idea-row')
    const rowBadges = (id: string) =>
      rows.filter(r => within(r).queryByText(id) !== null)
    expect(rowBadges('ideas.statusPlanned')).toHaveLength(1)
    expect(rowBadges('ideas.statusCaptured')).toHaveLength(2)

    // captured time is rendered via the locale-aware formatter
    expect(screen.getAllByText('date:2026').length).toBeGreaterThan(0)
  })

  // LUM-708 traded the row's source line for a single dense line; provenance
  // now lives in the detail slide-over, which has its own suite.
  it('keeps the row to one line — no source line competing with the statement', () => {
    setIdeas([capturedWithContext, capturedFromTask])
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    expect(screen.queryByText('from the standup')).not.toBeInTheDocument()
    expect(screen.queryByText('ideas.fromTask LUM-9')).not.toBeInTheDocument()
  })

  it('links a PLANNED idea to the plan run it was materialised into', () => {
    setIdeas([planned, capturedWithContext])
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    // The row shows a compact marker; the initiative name rides the tooltip.
    const link = screen.getByText('ideas.plannedMarker').closest('a')
    expect(link).not.toBeNull()
    expect(link).toHaveAttribute('href', '/workspace/lumo/plan/run-1')
    expect(link).toHaveAttribute('title', 'ideas.plannedInto Idea visibility')
  })

  it('shows no Initiative link on a CAPTURED idea', () => {
    setIdeas([capturedWithContext])
    const { container } = render(<IdeaPoolPage workspaceUrl='lumo' />)
    expect(container.querySelector('a[href*="/plan/"]')).toBeNull()
  })

  it('filters the pool by the search box', () => {
    setIdeas([planned, capturedWithContext, capturedFromTask])
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    fireEvent.change(screen.getByPlaceholderText('ideas.search'), {
      target: { value: 'dark' },
    })

    expect(screen.getByText('dark mode toggle')).toBeInTheDocument()
    expect(screen.queryByText('ship the idea pool')).not.toBeInTheDocument()
    expect(screen.queryByText('faster search')).not.toBeInTheDocument()
  })

  it('renders the empty state when the pool is empty', () => {
    setIdeas([])
    render(<IdeaPoolPage workspaceUrl='lumo' />)
    expect(screen.getByText('ideas.empty')).toBeInTheDocument()
  })

  it('surfaces a load error with retry', () => {
    const refetch = jest.fn()
    mockUseIdeas.mockReturnValue({
      ideas: [],
      loading: false,
      error: 'boom',
      refetch,
    })
    render(<IdeaPoolPage workspaceUrl='lumo' />)
    expect(screen.getByText('boom')).toBeInTheDocument()
    fireEvent.click(screen.getByText('common.retry'))
    expect(refetch).toHaveBeenCalled()
  })
})
