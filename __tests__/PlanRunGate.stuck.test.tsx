/** @jest-environment jsdom */

/**
 * LUM-689 — the gate dispatcher's "nothing to confirm yet" screen.
 *
 * A working stage used to render a bare spinner and FAILED fell through to the
 * generic non-actionable line, so a run whose Stage-3 runner never fired (every
 * gate-B-confirmed run, before Stage 3 was wired) left the user staring at
 * "Working on the plan…" with no way out. Both states now offer the retry that
 * re-dispatches the stuck segment.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? `${id} ${Object.values(values).join(' ')}` : id),
  }),
}))

// The gate boards pull in the whole editing stack; this suite only cares about
// the non-gate branches of the dispatcher.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/plan-run/ClusterGateBoard',
  () => ({ ClusterGateBoard: () => <div /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/plan-run/GateBBoard',
  () => ({
    GateBBoard: () => <div />,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/plan-run/GateCView',
  () => ({
    GateCView: () => <div />,
  })
)

jest.mock('@/lib/api-client/plan-runs', () => ({
  planRunsClient: { getRun: jest.fn(), retry: jest.fn() },
}))

import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PlanRunGate } from '@/app/workspace/[workspaceUrl]/components/plan-run/PlanRunGate'
import { planRunsClient } from '@/lib/api-client/plan-runs'

const getRun = planRunsClient.getRun as jest.Mock
const retry = planRunsClient.retry as jest.Mock

function renderGate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PlanRunGate runId='run_1' workspaceUrl='lumo' />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  retry.mockResolvedValue({ run: { id: 'run_1', stage: 'GENERATING' } })
})

it('offers a retry while a step is still working', async () => {
  getRun.mockResolvedValue({ id: 'run_1', stage: 'GENERATING' })

  renderGate()

  expect(await screen.findByText('planGate.working')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'planGate.retry' })
  ).toBeInTheDocument()
})

it('renders FAILED as its own failure state, not the generic stage line', async () => {
  getRun.mockResolvedValue({ id: 'run_1', stage: 'FAILED' })

  renderGate()

  expect(await screen.findByText('planGate.failed')).toBeInTheDocument()
  expect(screen.queryByText(/planGate.notActionable/)).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'planGate.retry' })
  ).toBeInTheDocument()
})

it('the retry button re-dispatches the stuck segment', async () => {
  getRun.mockResolvedValue({ id: 'run_1', stage: 'FAILED' })

  renderGate()
  await userEvent.click(
    await screen.findByRole('button', { name: 'planGate.retry' })
  )

  await waitFor(() => expect(retry).toHaveBeenCalledWith('run_1'))
})

it('surfaces a failed retry instead of silently doing nothing', async () => {
  getRun.mockResolvedValue({ id: 'run_1', stage: 'FAILED' })
  retry.mockRejectedValue(new Error('409'))

  renderGate()
  await userEvent.click(
    await screen.findByRole('button', { name: 'planGate.retry' })
  )

  expect(await screen.findByText('planGate.retryFailed')).toBeInTheDocument()
})

it('still renders a real gate stage without the retry screen', async () => {
  getRun.mockResolvedValue({ id: 'run_1', stage: 'DRAFT_READY' })

  renderGate()

  await waitFor(() =>
    expect(screen.queryByText('planGate.working')).not.toBeInTheDocument()
  )
  expect(
    screen.queryByRole('button', { name: 'planGate.retry' })
  ).not.toBeInTheDocument()
})
