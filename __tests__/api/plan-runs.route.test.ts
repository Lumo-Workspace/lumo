/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services', () => ({
  planRunService: { startRun: jest.fn(), getActiveRun: jest.fn() },
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { planRunService } from '@/lib/services'
import { POST } from '@/app/api/plan-runs/route'
import { GET } from '@/app/api/plan-runs/active/route'

const ID = {
  clerkId: 'u1',
  memberId: 'm1',
  workspaceId: 'w1',
  workspaceSlug: 'lumo',
  workspaceName: 'Lumo',
  source: 'bearer' as const,
}

const RUN = {
  id: 'run-1',
  teamId: 'team-1',
  workspaceId: 'w1',
  stage: 'CLUSTERING' as const,
  startedByMemberId: 'm1',
  inputIdeaIds: ['idea-a'],
  priorityId: null,
  prioritySnapshot: null,
  proseDocument: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

const postReq = (b?: unknown) =>
  b === undefined
    ? new NextRequest('http://x/api/plan-runs', { method: 'POST' })
    : new NextRequest('http://x/api/plan-runs', {
        method: 'POST',
        body: JSON.stringify(b),
      })
const getReq = () =>
  new NextRequest('http://x/api/plan-runs/active', { method: 'GET' })

beforeEach(() => jest.clearAllMocks())

describe('POST /api/plan-runs', () => {
  it('201 starts a run for the caller workspace and returns it', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.startRun as jest.Mock).mockResolvedValue(RUN)

    const res = await POST(postReq({}))

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.run.id).toBe('run-1')
    expect(json.run.stage).toBe('CLUSTERING')
    expect(planRunService.startRun).toHaveBeenCalledWith({
      workspaceId: 'w1',
      memberId: 'm1',
      abandonActive: undefined,
    })
  })

  it('passes abandonActive through to the service', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.startRun as jest.Mock).mockResolvedValue(RUN)

    await POST(postReq({ abandonActive: true }))

    expect(planRunService.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ abandonActive: true })
    )
  })

  it('tolerates an empty body (no override)', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.startRun as jest.Mock).mockResolvedValue(RUN)

    const res = await POST(postReq())

    expect(res.status).toBe(201)
    // No override in the body → the key is omitted entirely (not sent as
    // undefined), so the service applies its default (refuse-if-active).
    const arg = (planRunService.startRun as jest.Mock).mock.calls[0][0]
    expect('abandonActive' in arg).toBe(false)
  })

  it('400 rejects a non-boolean abandonActive via Zod', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)

    const res = await POST(postReq({ abandonActive: 'yes' }))

    expect(res.status).toBe(400)
    expect(planRunService.startRun).not.toHaveBeenCalled()
  })

  it('surfaces the run-lock 409 from the service', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.startRun as jest.Mock).mockRejectedValue(
      Object.assign(new Error('An active plan run already exists'), {
        status: 409,
      })
    )

    const res = await POST(postReq({}))

    expect(res.status).toBe(409)
  })

  it('401 when unauthenticated', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const res = await POST(postReq({}))

    expect(res.status).toBe(401)
    expect(planRunService.startRun).not.toHaveBeenCalled()
  })
})

describe('GET /api/plan-runs/active', () => {
  it('200 returns the active run', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.getActiveRun as jest.Mock).mockResolvedValue({
      ...RUN,
      stage: 'ALIGNING',
    })

    const res = await GET(getReq())

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.run.stage).toBe('ALIGNING')
    expect(planRunService.getActiveRun).toHaveBeenCalledWith({
      workspaceId: 'w1',
    })
  })

  it('200 returns run: null when there is no active run', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(planRunService.getActiveRun as jest.Mock).mockResolvedValue(null)

    const res = await GET(getReq())

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.run).toBeNull()
  })

  it('401 when unauthenticated', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const res = await GET(getReq())

    expect(res.status).toBe(401)
    expect(planRunService.getActiveRun).not.toHaveBeenCalled()
  })
})
