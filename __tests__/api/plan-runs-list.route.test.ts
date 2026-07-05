/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services', () => ({
  planRunService: { listRuns: jest.fn(), startRun: jest.fn() },
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { planRunService } from '@/lib/services'
import { GET } from '@/app/api/plan-runs/route'

const ID = {
  clerkId: 'u1',
  memberId: 'm1',
  workspaceId: 'w1',
  workspaceSlug: 'lumo',
  workspaceName: 'Lumo',
  source: 'bearer' as const,
}

const RUNS = [
  {
    id: 'run-active',
    stage: 'CLUSTERS_READY' as const,
    createdAt: new Date(2).toISOString(),
    updatedAt: new Date(2).toISOString(),
    initiatives: [],
  },
  {
    id: 'run-done',
    stage: 'MATERIALIZED' as const,
    createdAt: new Date(1).toISOString(),
    updatedAt: new Date(1).toISOString(),
    initiatives: [{ id: 'init-1', number: 5, name: 'Ship it' }],
  },
]

const getReq = () =>
  new NextRequest('http://x/api/plan-runs', { method: 'GET' })

beforeEach(() => jest.clearAllMocks())

describe('GET /api/plan-runs', () => {
  it('200 returns the caller team runs (active + terminal), newest first', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.listRuns as jest.Mock).mockResolvedValue(RUNS)

    const res = await GET(getReq())

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.runs).toHaveLength(2)
    expect(json.runs[0].id).toBe('run-active')
    expect(json.runs[1].stage).toBe('MATERIALIZED')
    // Scoped to the caller's workspace — the service resolves the default team.
    expect(planRunService.listRuns).toHaveBeenCalledWith({ workspaceId: 'w1' })
  })

  it('200 returns an empty list when the team has no runs', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.listRuns as jest.Mock).mockResolvedValue([])

    const res = await GET(getReq())

    expect(res.status).toBe(200)
    expect((await res.json()).runs).toEqual([])
  })

  it('surfaces the 404 when the workspace has no default team', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.listRuns as jest.Mock).mockRejectedValue(
      Object.assign(new Error('No default team for workspace'), { status: 404 })
    )

    const res = await GET(getReq())

    expect(res.status).toBe(404)
  })

  it('401 when unauthenticated (never calls the service)', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const res = await GET(getReq())

    expect(res.status).toBe(401)
    expect(planRunService.listRuns).not.toHaveBeenCalled()
  })
})
