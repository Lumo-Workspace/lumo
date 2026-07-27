/** @jest-environment jsdom */

// LUM-677: the plan-runs surface on the Ideas page — the active run (linked to
// its current gate to resume) + past runs (linked to their archive), reachable
// without the CLI deep-link and NOT a separate top-level nav entry.

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

// The idea pool itself is empty here — this suite is about plan runs.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeas', () => ({
  useIdeas: () => ({
    ideas: [],
    loading: false,
    error: null,
    refetch: jest.fn(),
  }),
}))

const mockUsePlanRuns = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/usePlanRuns', () => ({
  usePlanRuns: () => mockUsePlanRuns(),
}))

// Grouping is out of scope for this suite — flat list.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useIdeaGrouping', () => ({
  useIdeaGrouping: () => ({ clustering: null, loading: false, error: null }),
}))

// The detail slide-over's edit mutation (LUM-683) — stubbed; this suite covers
// the plan-runs surface, not the drawer.
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
import { render, screen, fireEvent } from '@testing-library/react'
import { IdeaPoolPage } from '@/app/workspace/[workspaceUrl]/components/pages/IdeaPoolPage'
import type { PlanRunListRow } from '@/lib/api-client/plan-runs'

const activeRun: PlanRunListRow = {
  id: 'run-active',
  stage: 'CLUSTERS_READY',
  createdAt: '2026-07-04T10:00:00.000Z',
  updatedAt: '2026-07-04T10:00:00.000Z',
  initiatives: [],
}

const materializedRun: PlanRunListRow = {
  id: 'run-done',
  stage: 'MATERIALIZED',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  initiatives: [{ id: 'init-1', number: 5, name: 'Ship the revamp' }],
}

const abandonedRun = (n: number): PlanRunListRow => ({
  id: `run-gone-${n}`,
  stage: 'ABANDONED',
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
  initiatives: [],
})

function setRuns(runs: PlanRunListRow[], overrides = {}) {
  mockUsePlanRuns.mockReturnValue({
    runs,
    loading: false,
    error: null,
    refetch: jest.fn(),
    ...overrides,
  })
}

beforeEach(() => jest.clearAllMocks())

describe('IdeaPoolPage — plan-runs surface (LUM-677)', () => {
  it('renders the plan-runs section on the Ideas page (not a separate nav entry)', () => {
    setRuns([activeRun, materializedRun])
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    // The section lives inside the Ideas page itself.
    expect(screen.getByTestId('plan-runs-section')).toBeInTheDocument()
    expect(screen.getByText('planRuns.title')).toBeInTheDocument()
  })

  it('links the active run to its current gate so it can be resumed', () => {
    setRuns([activeRun, materializedRun])
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    const active = screen.getByTestId('plan-run-active')
    expect(active).toHaveAttribute('href', '/workspace/lumo/plan/run-active')
    expect(active).toHaveTextContent('planRuns.resume')
  })

  it('links each past run to its archive, showing status + materialized initiative', () => {
    setRuns([activeRun, materializedRun])
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    // An in-flight run opens the card, so the history is already visible.
    const past = screen.getByTestId('plan-run-past')
    expect(past).toHaveAttribute('href', '/workspace/lumo/plan/run-done')
    expect(past).toHaveTextContent('planRuns.status.materialized')
    expect(past).toHaveTextContent('planRuns.materializedInto Ship the revamp')
  })

  it('renders nothing (no section) when the team has no plan runs', () => {
    setRuns([])
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    expect(screen.queryByTestId('plan-runs-section')).not.toBeInTheDocument()
  })

  it('shows only past runs when there is no active run', () => {
    setRuns([materializedRun])
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    expect(screen.getByTestId('plan-runs-section')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-run-active')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('plan-runs-toggle'))
    expect(screen.getByTestId('plan-run-past')).toBeInTheDocument()
  })
})

describe('idea pool plan runs card', () => {
  it('collapses to a one-line summary and keeps abandoned runs behind a toggle', () => {
    // A purely terminal history: 1 materialized + 3 abandoned, no active run.
    setRuns([
      materializedRun,
      abandonedRun(1),
      abandonedRun(2),
      abandonedRun(3),
    ])
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    // Collapsed by default — the header alone carries the counts and the date
    // of the newest run; no run rows are rendered yet.
    const section = screen.getByTestId('plan-runs-section')
    expect(section).toHaveTextContent('planRuns.countMaterialized 1')
    expect(section).toHaveTextContent('planRuns.countAbandoned 3')
    expect(section).toHaveTextContent('planRuns.lastRun date:2026')
    expect(screen.queryByTestId('plan-run-past')).not.toBeInTheDocument()

    // Expanding reveals the run rows — but only the materialized one.
    fireEvent.click(screen.getByTestId('plan-runs-toggle'))
    expect(screen.getAllByTestId('plan-run-past')).toHaveLength(1)
    expect(screen.getByTestId('plan-runs-abandoned-toggle')).toHaveTextContent(
      'planRuns.showAbandoned 3'
    )

    // The abandoned runs have their own fold.
    fireEvent.click(screen.getByTestId('plan-runs-abandoned-toggle'))
    expect(screen.getAllByTestId('plan-run-past')).toHaveLength(4)
    expect(screen.getByTestId('plan-runs-abandoned-toggle')).toHaveTextContent(
      'planRuns.hideAbandoned 3'
    )

    // …and collapsing the card puts the whole history away again.
    fireEvent.click(screen.getByTestId('plan-runs-toggle'))
    expect(screen.queryByTestId('plan-run-past')).not.toBeInTheDocument()
  })

  it('opens by default when a run is still in flight', () => {
    setRuns([activeRun, materializedRun])
    render(<IdeaPoolPage workspaceUrl='lumo' />)

    // An active run is the one thing here that wants acting on — never folded.
    expect(screen.getByTestId('plan-run-active')).toBeInTheDocument()
    expect(screen.getByTestId('plan-runs-toggle')).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })
})
