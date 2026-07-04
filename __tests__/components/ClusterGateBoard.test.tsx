/**
 * @jest-environment jsdom
 *
 * LUM-669 (HUMAN criterion, machine-backed): the gate-A board renders clusters
 * as cards + a separate orphan zone, and a reviewer can rename a cluster and
 * move an idea between buckets — with the confirm reflecting exactly those
 * edits, carrying the loaded revision for optimistic concurrency.
 */
const mockGetClusterGate = jest.fn()
const mockConfirmClusterGate = jest.fn()

jest.mock('@/lib/api-client', () => {
  class ApiClientError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return {
    ApiClientError,
    planRunsClient: {
      getClusterGate: (...a: unknown[]) => mockGetClusterGate(...a),
      confirmClusterGate: (...a: unknown[]) => mockConfirmClusterGate(...a),
    },
  }
})

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ClusterGateBoard } from '@/app/workspace/[workspaceUrl]/components/plan-run/ClusterGateBoard'

const { ApiClientError } = jest.requireMock('@/lib/api-client') as {
  ApiClientError: typeof import('@/lib/api-client').ApiClientError
}

const view = {
  run: { id: 'run-1', stage: 'CLUSTERS_READY' as const },
  board: {
    clusters: [
      { name: 'Onboarding', thrust: 'smoother first run', ideaIds: ['idea-a'] },
      { name: 'Billing', thrust: 'fewer failed charges', ideaIds: ['idea-b'] },
    ],
    orphans: ['idea-c'],
  },
  revision: 7,
  confirmedAt: null,
  ideas: [
    { id: 'idea-a', statement: 'Idea A', sourceContext: null },
    { id: 'idea-b', statement: 'Idea B', sourceContext: null },
    { id: 'idea-c', statement: 'Idea C', sourceContext: null },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetClusterGate.mockResolvedValue(view)
  mockConfirmClusterGate.mockResolvedValue({
    run: { id: 'run-1', stage: 'ALIGNING' },
  })
})

it('renders cluster cards + an orphan zone', async () => {
  render(<ClusterGateBoard runId='run-1' />)

  // Cards are named inputs; the orphan zone is a distinct labelled section.
  expect(await screen.findByLabelText('Cluster 1 name')).toHaveValue(
    'Onboarding'
  )
  expect(screen.getByLabelText('Cluster 2 name')).toHaveValue('Billing')
  expect(screen.getByRole('heading', { name: /Orphans/ })).toBeInTheDocument()
  expect(screen.getByText('Idea C')).toBeInTheDocument()
})

it('confirm reflects a rename + a move (idea-c orphan → cluster 1)', async () => {
  const onConfirmed = jest.fn()
  render(<ClusterGateBoard runId='run-1' onConfirmed={onConfirmed} />)

  const nameInput = await screen.findByLabelText('Cluster 1 name')
  fireEvent.change(nameInput, { target: { value: 'Onboarding v2' } })

  // Move the orphan idea C into cluster index 0.
  const moveOrphan = screen.getByLabelText('Move orphan idea Idea C')
  fireEvent.change(moveOrphan, { target: { value: '0' } })

  fireEvent.click(screen.getByRole('button', { name: 'Confirm clusters' }))

  await waitFor(() => expect(mockConfirmClusterGate).toHaveBeenCalledTimes(1))
  const [runId, payload] = mockConfirmClusterGate.mock.calls[0] as [
    string,
    {
      clusters: { name: string; ideaIds: string[] }[]
      orphans: string[]
      ifRevision: number
    },
  ]
  expect(runId).toBe('run-1')
  expect(payload.ifRevision).toBe(7) // the loaded revision rides along
  expect(payload.clusters[0]).toMatchObject({
    name: 'Onboarding v2',
    ideaIds: ['idea-a', 'idea-c'],
  })
  expect(payload.orphans).toEqual([]) // idea-c left the orphan zone

  // The dispatcher is signalled so it can re-read the (now advanced) stage.
  await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1))
})

it('shows a conflict message when the confirm 409s (stale revision)', async () => {
  mockConfirmClusterGate.mockRejectedValue(
    new ApiClientError('Revision conflict: the clustering changed', 409)
  )
  render(<ClusterGateBoard runId='run-1' />)

  fireEvent.click(
    await screen.findByRole('button', { name: 'Confirm clusters' })
  )

  expect(await screen.findByText(/Revision conflict/)).toBeInTheDocument()
})
