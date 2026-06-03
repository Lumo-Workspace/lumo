/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: {
    archiveMilestone: jest.fn(),
    unarchiveMilestone: jest.fn(),
  },
}))

import { POST as archivePOST } from '@/app/api/milestones/[milestoneId]/archive/route'
import { POST as unarchivePOST } from '@/app/api/milestones/[milestoneId]/unarchive/route'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'

const mockIdentity = requireIdentity as jest.Mock
const mockArchive = milestoneService.archiveMilestone as jest.Mock
const mockUnarchive = milestoneService.unarchiveMilestone as jest.Mock

beforeEach(() => {
  mockIdentity.mockReset()
  mockArchive.mockReset()
  mockUnarchive.mockReset()
})

const params = { params: Promise.resolve({ milestoneId: 'm-1' }) }

describe('POST /api/milestones/[id]/archive', () => {
  it('archives and returns the milestone', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockArchive.mockResolvedValue({ id: 'm-1', archivedAt: '2026-06-02' })
    const res = await archivePOST(
      new Request('http://x', { method: 'POST' }) as any,
      params
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone).toMatchObject({ id: 'm-1' })
    expect(mockArchive).toHaveBeenCalledWith('m-1', 'mem-1')
  })

  it('maps a service status error to the response', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockArchive.mockRejectedValue(
      Object.assign(new Error('Milestone not found'), { status: 404 })
    )
    const res = await archivePOST(
      new Request('http://x', { method: 'POST' }) as any,
      params
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/milestones/[id]/unarchive', () => {
  it('unarchives and returns the milestone', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockUnarchive.mockResolvedValue({ id: 'm-1', archivedAt: null })
    const res = await unarchivePOST(
      new Request('http://x', { method: 'POST' }) as any,
      params
    )
    expect(res.status).toBe(200)
    expect(mockUnarchive).toHaveBeenCalledWith('m-1', 'mem-1')
  })
})
