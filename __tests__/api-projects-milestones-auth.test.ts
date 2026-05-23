/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/api/helpers', () => ({
  loadProjectAndMember: jest.fn(),
  zodError: jest.fn(),
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: {
    listMilestones: jest.fn(),
    createMilestone: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { countTasksByStatus: jest.fn() },
}))

import { GET, POST } from '@/app/api/projects/[id]/milestones/route'
import { requireIdentity } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const mockIdentity = requireIdentity as jest.Mock
const mockLoad = loadProjectAndMember as jest.Mock
const mockList = milestoneService.listMilestones as jest.Mock
const mockCreate = milestoneService.createMilestone as jest.Mock
const mockCount = milestoneRepository.countTasksByStatus as jest.Mock

beforeEach(() => {
  mockIdentity.mockReset()
  mockLoad.mockReset()
  mockList.mockReset()
  mockCreate.mockReset()
  mockCount.mockReset()
})

const params = { params: Promise.resolve({ id: 'proj-1' }) }

describe('GET /api/projects/[id]/milestones — auth', () => {
  it('uses requireIdentity (bearer-token compatible) and passes clerkId to loadProjectAndMember', async () => {
    mockIdentity.mockResolvedValue({
      clerkId: 'user_clerk_123',
      memberId: 'mem-1',
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      workspaceName: 'Lumo',
      source: 'bearer',
    })
    mockLoad.mockResolvedValue({ member: { id: 'mem-1' } })
    mockList.mockResolvedValue([
      { id: 'm-1', name: 'Q3', status: 'ACTIVE' },
    ])
    mockCount.mockResolvedValue({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 0,
    })

    const req = new Request('http://x/api/projects/proj-1/milestones', {
      headers: { authorization: 'Bearer lum_test' },
    })
    const res = await GET(req as any, params)

    expect(mockIdentity).toHaveBeenCalledTimes(1)
    expect(mockLoad).toHaveBeenCalledWith('proj-1', 'user_clerk_123')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestones).toHaveLength(1)
  })

  it('propagates 401 NextResponse from requireIdentity unchanged', async () => {
    const { NextResponse } = await import('next/server')
    const unauth = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    mockIdentity.mockResolvedValue(unauth)

    const req = new Request('http://x/api/projects/proj-1/milestones')
    const res = await GET(req as any, params)

    expect(res.status).toBe(401)
    expect(mockLoad).not.toHaveBeenCalled()
  })
})

describe('POST /api/projects/[id]/milestones — auth', () => {
  it('uses requireIdentity (bearer-token compatible) and passes clerkId to loadProjectAndMember', async () => {
    mockIdentity.mockResolvedValue({
      clerkId: 'user_clerk_123',
      memberId: 'mem-1',
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      workspaceName: 'Lumo',
      source: 'bearer',
    })
    mockLoad.mockResolvedValue({ member: { id: 'mem-1' } })
    mockCreate.mockResolvedValue({ id: 'm-new', name: 'Q4' })

    const req = new Request('http://x/api/projects/proj-1/milestones', {
      method: 'POST',
      headers: {
        authorization: 'Bearer lum_test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Q4' }),
    })
    const res = await POST(req as any, params)

    expect(mockIdentity).toHaveBeenCalledTimes(1)
    expect(mockLoad).toHaveBeenCalledWith('proj-1', 'user_clerk_123')
    expect(mockCreate).toHaveBeenCalled()
    expect(res.status).toBe(201)
  })
})
