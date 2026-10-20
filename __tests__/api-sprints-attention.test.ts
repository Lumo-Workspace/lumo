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
jest.mock('@/lib/services/sprint-attention.service', () => ({
  sprintAttentionService: { getForSprint: jest.fn() },
}))

import { GET } from '@/app/api/sprints/[sprintId]/attention/route'
import { requireIdentity } from '@/lib/auth'
import { sprintRepository } from '@/lib/repositories'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'
import { sprintAttentionService } from '@/lib/services/sprint-attention.service'

const mockIdentity = requireIdentity as jest.Mock
const mockFindById = sprintRepository.findById as jest.Mock
const mockRequireTeam = requireTeamMemberOrOwner as jest.Mock
const mockGet = sprintAttentionService.getForSprint as jest.Mock

const identity = { clerkId: 'c1', workspaceId: 'ws1', memberId: 'm1' }
const sprint = {
  id: 's1',
  number: 3,
  teamId: 'team1',
  team: { workspaceId: 'ws1' },
}

function call(query = '') {
  const req = {
    nextUrl: new URL(`http://x/api/sprints/s1/attention${query}`),
  } as never
  return GET(req, { params: Promise.resolve({ sprintId: 's1' }) })
}

beforeEach(() => {
  jest.resetAllMocks()
  mockIdentity.mockResolvedValue(identity)
  mockFindById.mockResolvedValue(sprint)
  mockRequireTeam.mockResolvedValue({ memberId: 'm1', reason: 'team' })
  mockGet.mockResolvedValue({ scope: 'team', queue: [] })
})

describe('GET /api/sprints/[sprintId]/attention', () => {
  it('authorizes the sprint team, then calls the service with flat sprint fields and a server-side now', async () => {
    const res = await call('?scope=mine')
    expect(res.status).toBe(200)
    expect(mockRequireTeam).toHaveBeenCalledWith(
      identity,
      { workspaceId: 'ws1', teamId: 'team1' },
      'Sprint not found'
    )
    const [ref, opts] = mockGet.mock.calls[0]!
    expect(ref).toEqual({
      id: 's1',
      number: 3,
      teamId: 'team1',
      workspaceId: 'ws1',
    })
    expect(opts).toMatchObject({ viewerMemberId: 'm1', scope: 'mine' })
    expect(opts.now).toBeInstanceOf(Date)
  })

  it('defaults scope to team', async () => {
    await call()
    expect(mockGet.mock.calls[0]![1].scope).toBe('team')
  })

  it('rejects an unknown scope with 400', async () => {
    const res = await call('?scope=everyone')
    expect(res.status).toBe(400)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('404s a missing sprint', async () => {
    mockFindById.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('maps a team-access error to its status', async () => {
    mockRequireTeam.mockRejectedValue(
      Object.assign(new Error('Sprint not found'), { status: 404 })
    )
    expect((await call()).status).toBe(404)
    expect(mockGet).not.toHaveBeenCalled()
  })
})
