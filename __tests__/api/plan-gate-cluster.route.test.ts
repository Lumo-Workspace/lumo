/**
 * @jest-environment node
 *
 * LUM-669: the gate-A (闸门A) confirm endpoint. POST writes the reviewer's
 * edited clustering, advances the run to ALIGNING, and triggers Stage-2; a
 * stale confirm (out-of-date `ifRevision`) is rejected with 409 before any
 * clobbering; GET returns the board. Auth, the service, and the Stage-2 runner
 * are mocked — this test pins the route's contract, not the state machine.
 */
import { GET, POST } from '@/app/api/plan-runs/[runId]/gate/cluster/route'

jest.mock('@/lib/auth', () => ({
  requireIdentity: jest
    .fn()
    .mockResolvedValue({ workspaceId: 'w1', memberId: 'm1' }),
}))
jest.mock('@/lib/services/plan-run.service', () => ({
  planRunService: {
    getClusterGateView: jest.fn(),
    confirmClusterGate: jest.fn(),
  },
}))
jest.mock('@/lib/services/plan-align-runner', () => ({
  triggerAlignStage: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))

import { planRunService } from '@/lib/services/plan-run.service'
import { triggerAlignStage } from '@/lib/services/plan-align-runner'
import { waitUntil } from '@/lib/runtime/wait-until'

const confirmClusterGate = planRunService.confirmClusterGate as jest.Mock
const getClusterGateView = planRunService.getClusterGateView as jest.Mock
const trigger = triggerAlignStage as jest.Mock

const params = (runId: string) => ({ params: Promise.resolve({ runId }) })

function postReq(body: unknown): Request {
  return new Request('http://x/api/plan-runs/run-1/gate/cluster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  clusters: [
    { name: 'Onboarding', thrust: 'smoother first run', ideaIds: ['idea-a'] },
    { name: 'Billing', thrust: 'fewer failed charges', ideaIds: ['idea-b'] },
  ],
  orphans: ['idea-c'],
  ifRevision: 0,
}

const advancedRun = { id: 'run-1', stage: 'ALIGNING' as const }

beforeEach(() => jest.clearAllMocks())

describe('POST /api/plan-runs/[runId]/gate/cluster', () => {
  it('writes the edit, advances to ALIGNING, and triggers Stage-2', async () => {
    confirmClusterGate.mockResolvedValue(advancedRun)

    const res = await POST(postReq(validBody), params('run-1'))
    expect(res.status).toBe(200)

    // The full edit + caller identity + loaded revision reach the service.
    expect(confirmClusterGate).toHaveBeenCalledWith({
      planRunId: 'run-1',
      workspaceId: 'w1',
      edited: { clusters: validBody.clusters, orphans: validBody.orphans },
      ifRevision: 0,
      confirmedBy: 'm1',
    })

    // Stage-2 is triggered out of band (via waitUntil) for the advanced run.
    expect(trigger).toHaveBeenCalledWith('run-1')
    expect(waitUntil).toHaveBeenCalledTimes(1)

    const body = (await res.json()) as { run: { stage: string } }
    expect(body.run.stage).toBe('ALIGNING')
  })

  it('stale cluster confirm is rejected 409', async () => {
    confirmClusterGate.mockRejectedValue(
      Object.assign(new Error('Revision conflict: the clustering changed'), {
        status: 409,
      })
    )

    const res = await POST(
      postReq({ ...validBody, ifRevision: 0 }),
      params('run-1')
    )

    expect(res.status).toBe(409)
    // A rejected confirm must NOT trigger Stage-2 — nothing was written.
    expect(trigger).not.toHaveBeenCalled()
    expect(waitUntil).not.toHaveBeenCalled()
  })

  it('rejects a malformed body with 400 and never calls the service', async () => {
    const res = await POST(postReq({ clusters: [] }), params('run-1'))
    expect(res.status).toBe(400)
    expect(confirmClusterGate).not.toHaveBeenCalled()
    expect(trigger).not.toHaveBeenCalled()
  })

  it('surfaces a 422 partition violation from the service', async () => {
    confirmClusterGate.mockRejectedValue(
      Object.assign(new Error('Edited clustering dropped 1 idea id(s)'), {
        status: 422,
      })
    )
    const res = await POST(postReq(validBody), params('run-1'))
    expect(res.status).toBe(422)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('surfaces a 404 for a run outside the caller workspace', async () => {
    confirmClusterGate.mockRejectedValue(
      Object.assign(new Error('Plan run run-1 not found'), { status: 404 })
    )
    const res = await POST(postReq(validBody), params('run-1'))
    expect(res.status).toBe(404)
  })
})

describe('GET /api/plan-runs/[runId]/gate/cluster', () => {
  it('returns the board view for the run', async () => {
    getClusterGateView.mockResolvedValue({
      run: { id: 'run-1', stage: 'CLUSTERS_READY' },
      board: { clusters: validBody.clusters, orphans: validBody.orphans },
      revision: 3,
      confirmedAt: null,
      ideas: [{ id: 'idea-a', statement: 'A', sourceContext: null }],
    })

    const res = await GET(new Request('http://x'), params('run-1'))
    expect(res.status).toBe(200)
    expect(getClusterGateView).toHaveBeenCalledWith({
      planRunId: 'run-1',
      workspaceId: 'w1',
    })
    const body = (await res.json()) as { revision: number }
    expect(body.revision).toBe(3)
  })

  it('404s when the run is missing / not in the workspace', async () => {
    getClusterGateView.mockRejectedValue(
      Object.assign(new Error('Plan run run-1 not found'), { status: 404 })
    )
    const res = await GET(new Request('http://x'), params('run-1'))
    expect(res.status).toBe(404)
  })
})
