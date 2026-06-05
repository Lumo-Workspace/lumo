/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: { listByWorkspace: jest.fn() },
}))
import type { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'
import { GET } from '@/app/api/milestones/workspace/route'
const mockId = requireIdentity as jest.Mock
const mockList = milestoneService.listByWorkspace as jest.Mock
const req = (qs: string) =>
  new Request(`http://localhost/api/milestones/workspace${qs}`) as unknown as NextRequest
beforeEach(() => jest.clearAllMocks())

describe('GET /api/milestones/workspace', () => {
  it('returns workspace milestones (default active)', async () => {
    mockId.mockResolvedValueOnce({ workspaceId: 'w1' })
    mockList.mockResolvedValueOnce([{ id: 'm1' }])
    const res = await GET(req(''))
    expect(mockList).toHaveBeenCalledWith('w1', 'active')
    expect(await res.json()).toEqual({ milestones: [{ id: 'm1' }] })
  })
  it('passes ?filter=all through', async () => {
    mockId.mockResolvedValueOnce({ workspaceId: 'w1' })
    mockList.mockResolvedValueOnce([])
    await GET(req('?filter=all'))
    expect(mockList).toHaveBeenCalledWith('w1', 'all')
  })
  it('falls back to active for an unknown filter', async () => {
    mockId.mockResolvedValueOnce({ workspaceId: 'w1' })
    mockList.mockResolvedValueOnce([])
    await GET(req('?filter=bogus'))
    expect(mockList).toHaveBeenCalledWith('w1', 'active')
  })
})
