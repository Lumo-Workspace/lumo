/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/actor', () => ({
  getHumanActorId: jest.fn(),
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: { listTasks: jest.fn() },
}))

import { GET } from '@/app/api/milestones/[milestoneId]/tasks/route'
import { requireIdentity } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { milestoneService } from '@/lib/services/milestone.service'
import { NextResponse } from 'next/server'

const mockIdentity = requireIdentity as jest.Mock
const mockActor = getHumanActorId as jest.Mock
const mockList = milestoneService.listTasks as jest.Mock

beforeEach(() => {
  mockIdentity.mockReset()
  mockActor.mockReset()
  mockList.mockReset()
})

function req(url = 'http://x/api/milestones/m-1/tasks') {
  return new Request(url) as any
}

const params = { params: Promise.resolve({ milestoneId: 'm-1' }) }

const rawTask = {
  id: 't-1',
  number: 42,
  title: 'Fix bug',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  team: { identifier: 'LUM' },
  project: {
    id: 'p-1',
    name: 'Lumo',
    owner: { actor: { id: 'actor-9' } },
  },
}

describe('GET /api/milestones/[id]/tasks', () => {
  it('returns 401 when identity fails', async () => {
    mockIdentity.mockResolvedValue(
      NextResponse.json({ error: 'x' }, { status: 401 })
    )
    const res = await GET(req(), params)
    expect(res.status).toBe(401)
  })

  it('returns all tasks when assigned filter is absent', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockList.mockResolvedValue([rawTask])
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0]).toMatchObject({
      id: 't-1',
      teamIdentifier: 'LUM',
      project: { id: 'p-1', name: 'Lumo', ownerActorId: 'actor-9' },
    })
    expect(mockList).toHaveBeenCalledWith('m-1', 'mem-1', {})
    expect(mockActor).not.toHaveBeenCalled()
  })

  it('resolves actor id and filters when ?assigned=me', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockActor.mockResolvedValue('actor-1')
    mockList.mockResolvedValue([])
    await GET(req('http://x/api/milestones/m-1/tasks?assigned=me'), params)
    expect(mockList).toHaveBeenCalledWith('m-1', 'mem-1', {
      assigneeActorId: 'actor-1',
    })
  })

  it('returns empty list when assigned=me but member has no human actor', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockActor.mockResolvedValue(null)
    const res = await GET(
      req('http://x/api/milestones/m-1/tasks?assigned=me'),
      params
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tasks: [] })
    expect(mockList).not.toHaveBeenCalled()
  })

  it('propagates service errors with status code', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockList.mockRejectedValue(
      Object.assign(new Error('Milestone not found'), { status: 404 })
    )
    const res = await GET(req(), params)
    expect(res.status).toBe(404)
  })

  it('returns 500 when service throws unknown error', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockList.mockRejectedValue(new Error('boom'))
    const res = await GET(req(), params)
    expect(res.status).toBe(500)
  })
})
