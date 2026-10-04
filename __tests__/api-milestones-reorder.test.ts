/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/api/helpers', () => ({
  loadProjectForIdentity: jest.fn(),
  zodError: jest.requireActual('@/lib/api/helpers').zodError,
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: { reorderMilestones: jest.fn() },
}))

import { PATCH } from '@/app/api/projects/[id]/milestones/reorder/route'
import { requireIdentity } from '@/lib/auth'
import { loadProjectForIdentity } from '@/lib/api/helpers'
import { milestoneService } from '@/lib/services/milestone.service'

const mockIdentity = requireIdentity as jest.Mock
const mockLoad = loadProjectForIdentity as jest.Mock
const mockReorder = milestoneService.reorderMilestones as jest.Mock

const CUID = 'clm00000000000000000000a'

function req(body: unknown) {
  return new NextRequest(
    'http://localhost/api/projects/p-1/milestones/reorder',
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    }
  )
}
const params = { params: Promise.resolve({ id: 'p-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue({ clerkId: 'u-1' })
  mockLoad.mockResolvedValue({ member: { id: 'mem-1' } })
})

describe('PATCH /api/projects/[id]/milestones/reorder', () => {
  it('returns ok when the service succeeds', async () => {
    mockReorder.mockResolvedValue(undefined)
    const res = await PATCH(req({ orderedIds: [CUID] }), params)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(mockReorder).toHaveBeenCalledWith('p-1', 'mem-1', [CUID])
  })

  it('returns 400 on an invalid body (non-cuid id)', async () => {
    const res = await PATCH(req({ orderedIds: ['not-a-cuid'] }), params)
    expect(res.status).toBe(400)
    expect(mockReorder).not.toHaveBeenCalled()
  })

  it('propagates a service 400 (incomplete set)', async () => {
    mockReorder.mockRejectedValue(
      Object.assign(new Error('incomplete'), { status: 400 })
    )
    const res = await PATCH(req({ orderedIds: [CUID] }), params)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'incomplete' })
  })
})
