/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/repositories', () => ({
  sprintRepository: {
    findByWorkspaceAndNumber: jest.fn(),
    countTasks: jest.fn(),
    completedCompletionRates: jest.fn(),
  },
  taskRepository: {
    findBySprint: jest.fn(),
  },
}))
jest.mock('@/lib/auth/require-team-access', () => ({
  requireTeamMemberOrOwner: jest.fn(),
}))
jest.mock('@/lib/services/stats.service', () => ({
  getSprintBlockers: jest.fn(),
}))

import { GET } from '@/app/api/sprints/by-number/route'
import { requireIdentity } from '@/lib/auth'
import { sprintRepository, taskRepository } from '@/lib/repositories'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'
import { getSprintBlockers } from '@/lib/services/stats.service'
import { NextResponse } from 'next/server'

const mockIdentity = requireIdentity as jest.Mock
const mockFindByNumber = sprintRepository.findByWorkspaceAndNumber as jest.Mock
const mockCountTasks = sprintRepository.countTasks as jest.Mock
const mockCompletedRates =
  sprintRepository.completedCompletionRates as jest.Mock
const mockFindBySprint = taskRepository.findBySprint as jest.Mock
const mockRequireTeam = requireTeamMemberOrOwner as jest.Mock
const mockBlockers = getSprintBlockers as jest.Mock

beforeEach(() => {
  mockIdentity.mockReset()
  mockFindByNumber.mockReset()
  mockCountTasks.mockReset()
  mockCompletedRates.mockReset()
  mockFindBySprint.mockReset()
  mockRequireTeam.mockReset()
  mockBlockers.mockReset()
})

function req(
  url = 'http://x/api/sprints/by-number?workspaceUrl=acme&number=1'
) {
  return { nextUrl: new URL(url) } as any
}

const identity = {
  clerkId: 'clerk-1',
  workspaceId: 'ws-1',
  workspaceSlug: 'acme',
}

const sprint = {
  id: 's-1',
  number: 1,
  name: 'Sprint 1',
  teamId: 'team-1',
  team: { workspaceId: 'ws-1' },
}

const rawTask = {
  id: 't-1',
  number: 42,
  title: 'Fix bug',
  status: 'IN_PROGRESS',
  team: { identifier: 'LUM' },
  project: { id: 'p-1', name: 'Lumo', owner: { actor: { id: 'actor-9' } } },
}

describe('GET /api/sprints/by-number', () => {
  it('returns 401 when identity fails', async () => {
    mockIdentity.mockResolvedValue(
      NextResponse.json({ error: 'x' }, { status: 401 })
    )
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('returns 400 when number is not a positive integer', async () => {
    mockIdentity.mockResolvedValue(identity)
    const res = await GET(
      req('http://x/api/sprints/by-number?workspaceUrl=acme&number=0')
    )
    expect(res.status).toBe(400)
  })

  it('returns 403 when workspaceUrl does not match the caller', async () => {
    mockIdentity.mockResolvedValue(identity)
    const res = await GET(
      req('http://x/api/sprints/by-number?workspaceUrl=other&number=1')
    )
    expect(res.status).toBe(403)
    expect(mockFindByNumber).not.toHaveBeenCalled()
  })

  it('returns 404 when the sprint is not found', async () => {
    mockIdentity.mockResolvedValue(identity)
    mockFindByNumber.mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(404)
  })

  it('bundles sprint, progress, blockers and shaped tasks in one response', async () => {
    mockIdentity.mockResolvedValue(identity)
    mockFindByNumber.mockResolvedValue(sprint)
    mockRequireTeam.mockResolvedValue({ memberId: 'mem-1' })
    mockCountTasks.mockResolvedValueOnce(2).mockResolvedValueOnce(5)
    mockBlockers.mockResolvedValue({ overdueTaskIds: [] })
    mockFindBySprint.mockResolvedValue([rawTask])
    mockCompletedRates.mockResolvedValue([0.5, 0.75])

    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.sprint).toMatchObject({ id: 's-1', number: 1 })
    expect(body.progress).toEqual({
      done: 2,
      total: 5,
      priorCompletionRates: [0.5, 0.75],
    })
    expect(mockCompletedRates).toHaveBeenCalledWith('team-1', 's-1')
    expect(body.topBlockers).toEqual({ overdueTaskIds: [] })
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0]).toMatchObject({
      id: 't-1',
      teamIdentifier: 'LUM',
      viewOrder: null,
      project: { id: 'p-1', name: 'Lumo', ownerActorId: 'actor-9' },
    })
    // tasks are fetched for the resolved sprint id, in parallel with counts
    expect(mockFindBySprint).toHaveBeenCalledWith('s-1')
  })

  it('propagates a thrown error status (e.g. forbidden team access)', async () => {
    mockIdentity.mockResolvedValue(identity)
    mockFindByNumber.mockResolvedValue(sprint)
    mockRequireTeam.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 403 })
    )
    const res = await GET(req())
    expect(res.status).toBe(403)
  })
})
