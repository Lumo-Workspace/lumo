/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services', () => ({
  planRunService: { getLatestClustering: jest.fn() },
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { planRunService } from '@/lib/services'
import { GET } from '@/app/api/plan-runs/latest-clustering/route'

const ID = {
  clerkId: 'u1',
  memberId: 'm1',
  workspaceId: 'w1',
  workspaceSlug: 'lumo',
  workspaceName: 'Lumo',
  source: 'bearer' as const,
}

const req = () =>
  new NextRequest('http://x/api/plan-runs/latest-clustering', { method: 'GET' })

beforeEach(() => jest.clearAllMocks())

describe('GET /api/plan-runs/latest-clustering', () => {
  it('200 returns the latest clustering for the caller workspace', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.getLatestClustering as jest.Mock).mockResolvedValue({
      runId: 'run-1',
      clusters: [{ name: 'Auth', ideaIds: ['a'] }],
    })

    const res = await GET(req())

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.clustering.runId).toBe('run-1')
    expect(json.clustering.clusters[0].name).toBe('Auth')
    expect(planRunService.getLatestClustering).toHaveBeenCalledWith({
      workspaceId: 'w1',
    })
  })

  it('200 returns clustering: null when no run has clustered', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.getLatestClustering as jest.Mock).mockResolvedValue(null)

    const res = await GET(req())

    expect(res.status).toBe(200)
    expect((await res.json()).clustering).toBeNull()
  })

  it('401 when unauthenticated (never calls the service)', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(planRunService.getLatestClustering).not.toHaveBeenCalled()
  })
})
