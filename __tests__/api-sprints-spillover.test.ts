/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  sprintRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/auth/require-team-access', () => ({
  requireTeamMemberOrOwner: jest.fn(),
}))
jest.mock('@/lib/services/sprint-spillover.service', () => ({
  sprintSpilloverService: { listForSprint: jest.fn() },
}))

import { NextResponse } from 'next/server'
import { GET } from '@/app/api/sprints/[sprintId]/spillover/route'
import { requireIdentity } from '@/lib/auth'
import { sprintRepository } from '@/lib/repositories'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'
import { sprintSpilloverService } from '@/lib/services/sprint-spillover.service'

// LUM-1281 — GET /api/sprints/[sprintId]/spillover contract.

const mockIdentity = requireIdentity as jest.Mock
const mockFindById = sprintRepository.findById as jest.Mock
const mockRequireTeam = requireTeamMemberOrOwner as jest.Mock
const mockList = sprintSpilloverService.listForSprint as jest.Mock

const identity = { clerkId: 'c1', workspaceId: 'ws1', memberId: 'm1' }
const sprint = {
  id: 's1',
  number: 13,
  teamId: 'team1',
  team: { workspaceId: 'ws1' },
}
const items = [
  {
    taskId: 't1',
    identifier: 'LUM-1',
    title: 'A',
    to: { number: 14, name: 'Sprint 14' },
  },
  { taskId: 't2', identifier: 'LUM-2', title: 'B', to: null },
]

function call() {
  const req = { nextUrl: new URL('http://x/api/sprints/s1/spillover') } as never
  return GET(req, { params: Promise.resolve({ sprintId: 's1' }) })
}

beforeEach(() => {
  jest.resetAllMocks()
  mockIdentity.mockResolvedValue(identity)
  mockFindById.mockResolvedValue(sprint)
  mockRequireTeam.mockResolvedValue({ memberId: 'm1', reason: 'team' })
  mockList.mockResolvedValue(items)
})

describe('GET /api/sprints/[sprintId]/spillover', () => {
  it('authorizes the sprint team, then returns the service rows as a bare array', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(mockRequireTeam).toHaveBeenCalledWith(
      identity,
      { workspaceId: 'ws1', teamId: 'team1' },
      'Sprint not found'
    )
    expect(mockList).toHaveBeenCalledWith({ id: 's1', workspaceId: 'ws1' })
    expect(await res.json()).toEqual(items)
  })

  it('passes an auth failure response through', async () => {
    mockIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await call()
    expect(res.status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('404s a missing sprint', async () => {
    mockFindById.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(404)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('maps a team-access error to its status (no cross-team read)', async () => {
    mockRequireTeam.mockRejectedValue(
      Object.assign(new Error('Sprint not found'), { status: 404 })
    )
    const res = await call()
    expect(res.status).toBe(404)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('500s an unexpected error', async () => {
    mockList.mockRejectedValue(new Error('db down'))
    const res = await call()
    expect(res.status).toBe(500)
  })
})
