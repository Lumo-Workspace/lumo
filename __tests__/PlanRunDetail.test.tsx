/** @jest-environment jsdom */

// react-intl → id-as-message, interpolated values appended; deterministic date.
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

// The active branch delegates to the gate dispatcher — stub it so we can detect
// the "resumable at its current gate" path without pulling the real gate boards.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/plan-run/PlanRunGate',
  () => ({
    PlanRunGate: ({ runId }: { runId: string }) => (
      <div data-testid='plan-run-gate-stub'>gate:{runId}</div>
    ),
  })
)

jest.mock('@/lib/api-client/plan-runs', () => ({
  planRunsClient: { getRun: jest.fn(), getArchive: jest.fn() },
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PlanRunDetail } from '@/app/workspace/[workspaceUrl]/components/plan-run/PlanRunDetail'
import { planRunsClient } from '@/lib/api-client/plan-runs'

const getRun = planRunsClient.getRun as jest.Mock
const getArchive = planRunsClient.getArchive as jest.Mock

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PlanRunDetail runId='run-1' workspaceUrl='lumo' />
    </QueryClientProvider>
  )
}

const ARCHIVE = {
  id: 'run-1',
  stage: 'MATERIALIZED' as const,
  startedByMemberId: 'm1',
  prioritySnapshot: null,
  createdAt: '2026-07-04T10:00:00.000Z',
  updatedAt: '2026-07-04T10:00:00.000Z',
  stageRecords: [
    {
      kind: 'CLUSTER' as const,
      model: 'deepseek',
      // Raw draft is overridden by the human-confirmed edit below.
      llmRawOutput: { clusters: [{ name: 'raw-auth' }], orphans: [] },
      humanConfirmedOutput: {
        clusters: [{ name: 'Auth revamp' }, { name: 'Billing' }],
        orphans: [],
      },
      confirmedBy: 'm1',
      confirmedAt: '2026-07-04T11:00:00.000Z',
      revision: 1,
    },
    {
      kind: 'ALIGN' as const,
      model: 'deepseek',
      llmRawOutput: {},
      humanConfirmedOutput: {},
      confirmedBy: 'm1',
      confirmedAt: '2026-07-04T12:00:00.000Z',
      revision: 1,
    },
    {
      kind: 'GENERATE' as const,
      model: 'deepseek',
      llmRawOutput: {},
      humanConfirmedOutput: null,
      confirmedBy: null,
      confirmedAt: null,
      revision: 0,
    },
  ],
  initiatives: [{ id: 'init-1', number: 5, goalStatement: 'Ship the revamp' }],
}

beforeEach(() => jest.clearAllMocks())

describe('PlanRunDetail', () => {
  it('an active run resumes at its current gate (delegates to the gate dispatcher)', async () => {
    getRun.mockResolvedValue({ id: 'run-1', stage: 'CLUSTERS_READY' })

    renderDetail()

    expect(await screen.findByTestId('plan-run-gate-stub')).toBeInTheDocument()
    // No archive fetch for an active run.
    expect(getArchive).not.toHaveBeenCalled()
  })

  it('a terminal run shows a read-only archive: clusters, per-gate decisions, initiative lineage', async () => {
    getRun.mockResolvedValue({ id: 'run-1', stage: 'MATERIALIZED' })
    getArchive.mockResolvedValue(ARCHIVE)

    renderDetail()

    // What was clustered — the human-confirmed edit wins over the raw draft.
    expect(await screen.findByText('Auth revamp')).toBeInTheDocument()
    expect(screen.getByText('Billing')).toBeInTheDocument()
    expect(screen.queryByText('raw-auth')).not.toBeInTheDocument()

    // Per-gate decisions: three gate rows, confirmed ones show a date, the
    // unconfirmed GENERATE gate shows the pending label.
    expect(screen.getAllByTestId('archive-gate')).toHaveLength(3)
    expect(screen.getByText('planRuns.gate.cluster')).toBeInTheDocument()
    expect(
      screen.getAllByText(/planRuns\.gateConfirmed date:2026/).length
    ).toBe(2)
    expect(screen.getByText('planRuns.gatePending')).toBeInTheDocument()

    // Materialized Initiative lineage — linked to the initiatives surface.
    const link = screen.getByTestId('archive-initiative')
    expect(link).toHaveTextContent('Ship the revamp')
    expect(link).toHaveAttribute('href', '/workspace/lumo/initiatives')
  })

  it('surfaces an archive load error', async () => {
    getRun.mockResolvedValue({ id: 'run-1', stage: 'ABANDONED' })
    getArchive.mockRejectedValue(new Error('boom'))

    renderDetail()

    expect(await screen.findByText('planRuns.loadError')).toBeInTheDocument()
  })
})
