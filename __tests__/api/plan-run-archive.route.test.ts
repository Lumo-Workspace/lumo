/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services', () => ({
  planRunService: { getArchive: jest.fn() },
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { planRunService } from '@/lib/services'
import { GET } from '@/app/api/plan-runs/[runId]/archive/route'

const ID = {
  clerkId: 'u1',
  memberId: 'm1',
  workspaceId: 'w1',
  workspaceSlug: 'lumo',
  workspaceName: 'Lumo',
  source: 'bearer' as const,
}

const ARCHIVE = {
  id: 'run-1',
  stage: 'MATERIALIZED',
  startedByMemberId: 'm1',
  prioritySnapshot: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  stageRecords: [],
  initiatives: [{ id: 'init-1', number: 5, name: 'Ship it' }],
}

const req = () =>
  new NextRequest('http://x/api/plan-runs/run-1/archive', { method: 'GET' })
const ctx = { params: Promise.resolve({ runId: 'run-1' }) }

beforeEach(() => jest.clearAllMocks())

describe('GET /api/plan-runs/[runId]/archive', () => {
  it('200 returns the run archive scoped to the caller workspace', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.getArchive as jest.Mock).mockResolvedValue(ARCHIVE)

    const res = await GET(req(), ctx)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.id).toBe('run-1')
    expect(json.initiatives[0].name).toBe('Ship it')
    expect(planRunService.getArchive).toHaveBeenCalledWith({
      runId: 'run-1',
      workspaceId: 'w1',
    })
  })

  it('404s a run outside the caller workspace (never leaks it)', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.getArchive as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Plan run run-1 not found'), { status: 404 })
    )

    const res = await GET(req(), ctx)

    expect(res.status).toBe(404)
  })

  it('401 when unauthenticated (never calls the service)', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const res = await GET(req(), ctx)

    expect(res.status).toBe(401)
    expect(planRunService.getArchive).not.toHaveBeenCalled()
  })
})
