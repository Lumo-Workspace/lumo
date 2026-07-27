/** @jest-environment jsdom */

// LUM-677: the Ideas page default view groups the pool by the most recent run's
// clustering, with a 'new / ungrouped' bucket, and falls back to a flat list
// when no run has clustered. The grouping is derived purely from stored
// clustering handed in by the hook — no clustering LLM call on load.

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

// Plan-runs surface is out of scope here — empty (renders nothing).
jest.mock('@/app/workspace/[workspaceUrl]/hooks/usePlanRuns', () => ({
  usePlanRuns: () => ({
    runs: [],
    loading: false,
    error: null,
    refetch: jest.fn(),
  }),
}))

const mockUseIdeaGrouping = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeaGrouping', () => ({
  useIdeaGrouping: () => mockUseIdeaGrouping(),
}))

// PageBreadcrumb pulls in SidebarTrigger -> useSidebar, which needs a
// SidebarProvider ancestor; the repo's other page suites stub it the same way.
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

// The detail slide-over's edit mutation (LUM-683) — stubbed; this suite covers
// the clustering grouping, not the drawer.
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
import { render, screen, within, fireEvent } from '@testing-library/react'
import { IdeaPoolPage } from '@/app/workspace/[workspaceUrl]/components/pages/IdeaPoolPage'
import type { ApiIdea } from '@/app/workspace/[workspaceUrl]/types'
import type { LatestClustering } from '@/lib/api-client/plan-runs'

const base: ApiIdea = {
  id: '',
  number: 0,
  identifier: '',
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

const authIdea: ApiIdea = {
  ...base,
  id: 'a',
  identifier: 'LUM-I1',
  statement: 'auth login flow',
}
const billingIdea: ApiIdea = {
  ...base,
  id: 'b',
  identifier: 'LUM-I2',
  statement: 'billing page',
}
// Captured after the run — not referenced by the clustering.
const freshIdea: ApiIdea = {
  ...base,
  id: 'c',
  identifier: 'LUM-I3',
  statement: 'brand new idea',
}

const clustering: LatestClustering = {
  runId: 'run-1',
  clusters: [
    { name: 'Authentication', ideaIds: ['a'] },
    { name: 'Billing', ideaIds: ['b'] },
  ],
}

function setIdeas(ideas: ApiIdea[]) {
  mockUseIdeas.mockReturnValue({
    ideas,
    loading: false,
    error: null,
    refetch: jest.fn(),
  })
}
function setClustering(c: LatestClustering | null) {
  mockUseIdeaGrouping.mockReturnValue({
    clustering: c,
    loading: false,
    error: null,
  })
}

beforeEach(() => jest.clearAllMocks())

describe('IdeaPoolPage — grouped default view (LUM-677)', () => {
  it('ideas page groups the pool by the latest run clustering with a new-ungrouped bucket', () => {
    setIdeas([authIdea, billingIdea, freshIdea])
    setClustering(clustering)

    render(<IdeaPoolPage workspaceUrl='lumo' />)

    // One section per cluster, headed by the cluster name.
    expect(screen.getAllByTestId('idea-cluster')).toHaveLength(2)
    const authSection = screen
      .getByText('Authentication')
      .closest('[data-testid="idea-cluster"]') as HTMLElement
    const billingSection = screen
      .getByText('Billing')
      .closest('[data-testid="idea-cluster"]') as HTMLElement

    // Each idea renders under its cluster.
    expect(within(authSection).getByText('auth login flow')).toBeInTheDocument()
    expect(within(billingSection).getByText('billing page')).toBeInTheDocument()

    // The idea captured since the run lands in the 'new / ungrouped' bucket,
    // not under any cluster.
    const ungrouped = screen.getByTestId('idea-ungrouped')
    expect(within(ungrouped).getByText('ideas.ungrouped')).toBeInTheDocument()
    expect(within(ungrouped).getByText('brand new idea')).toBeInTheDocument()
    expect(
      within(authSection).queryByText('brand new idea')
    ).not.toBeInTheDocument()
  })

  it('falls back to a flat time-ordered list when no run has clustered', () => {
    setIdeas([authIdea, billingIdea])
    setClustering(null)

    render(<IdeaPoolPage workspaceUrl='lumo' />)

    expect(screen.queryByTestId('idea-cluster')).not.toBeInTheDocument()
    expect(screen.queryByTestId('idea-ungrouped')).not.toBeInTheDocument()
    expect(screen.getByText('auth login flow')).toBeInTheDocument()
    expect(screen.getByText('billing page')).toBeInTheDocument()
  })

  it('flattens to a filtered list while searching, even with a clustering present', () => {
    setIdeas([authIdea, billingIdea, freshIdea])
    setClustering(clustering)

    render(<IdeaPoolPage workspaceUrl='lumo' />)
    fireEvent.change(screen.getByPlaceholderText('ideas.search'), {
      target: { value: 'billing' },
    })

    expect(screen.queryByTestId('idea-cluster')).not.toBeInTheDocument()
    expect(screen.getByText('billing page')).toBeInTheDocument()
    expect(screen.queryByText('auth login flow')).not.toBeInTheDocument()
  })
})
