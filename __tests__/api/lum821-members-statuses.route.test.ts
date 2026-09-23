/**
 * @jest-environment node
 *
 * LUM-821 P0: server half of `lumo member list` / `lumo task statuses`, plus
 * GET /api/tags opened to CLI bearer auth (search --tag, tag list).
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@clerk/nextjs/server', () => ({ clerkClient: jest.fn() }))
jest.mock('@/lib/actor', () => ({ getOrCreateHumanActor: jest.fn() }))
jest.mock('@/lib/services/member.service', () => ({
  memberService: { listMembers: jest.fn(), getAgentActors: jest.fn() },
}))
jest.mock('@/lib/services', () => ({
  tagService: { listTags: jest.fn(), createTag: jest.fn() },
}))

import { NextResponse, type NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { clerkClient } from '@clerk/nextjs/server'
import { memberService } from '@/lib/services/member.service'
import { tagService } from '@/lib/services'
import { GET as getMembers } from '@/app/api/workspaces/members/route'
import { GET as getStatuses } from '@/app/api/tasks/statuses/route'
import { GET as getTags } from '@/app/api/tags/route'

const mockIdentity = requireIdentity as jest.Mock
const req = (p: string) =>
  new Request(`http://localhost${p}`) as unknown as NextRequest

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue({
    workspaceId: 'w1',
    memberId: 'm1',
    source: 'bearer',
  })
})

describe('GET /api/workspaces/members', () => {
  it('returns the primary email (not merely the first) and asks Clerk for every member', async () => {
    ;(memberService.listMembers as jest.Mock).mockResolvedValue([
      {
        id: 'm1',
        clerkId: 'c1',
        role: 'OWNER',
        joinedAt: new Date(0),
        actor: { id: 'act1' },
      },
    ])
    ;(memberService.getAgentActors as jest.Mock).mockResolvedValue([
      {
        actorId: 'bot',
        name: 'Claude Code',
        avatarColor: '#000',
        type: 'CODING',
      },
    ])
    const getUserList = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'c1',
          firstName: '',
          lastName: '',
          imageUrl: null,
          primaryEmailAddressId: 'e2',
          emailAddresses: [
            { id: 'e1', emailAddress: 'old@x.com' },
            { id: 'e2', emailAddress: 'primary@x.com' },
          ],
        },
      ],
    })
    ;(clerkClient as jest.Mock).mockResolvedValue({ users: { getUserList } })

    const res = await getMembers(req('/api/workspaces/members'))
    const body = await res.json()
    expect(body.members[0]).toMatchObject({
      email: 'primary@x.com',
      name: 'primary@x.com',
      role: 'OWNER',
      actorId: 'act1',
    })
    expect(body.agentActors[0].name).toBe('Claude Code')
    expect(getUserList).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 })
    )
  })
})

describe('GET /api/tasks/statuses', () => {
  it('serves statuses with transitions, priorities and the gated DONE', async () => {
    const res = await getStatuses(req('/api/tasks/statuses'))
    const body = await res.json()
    expect(body.statuses.map((s: { value: string }) => s.value)).toEqual([
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
    ])
    expect(body.statuses[0].transitionsTo).toEqual([
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
    ])
    expect(body.priorities).toEqual(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    expect(body.gatedStatuses).toEqual(['DONE'])
  })

  it('is behind identity auth', async () => {
    mockIdentity.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await getStatuses(req('/api/tasks/statuses'))
    expect(res.status).toBe(401)
  })
})

describe('GET /api/tags (bearer-capable)', () => {
  it('lists tags for an API-key caller', async () => {
    ;(tagService.listTags as jest.Mock).mockResolvedValue([
      {
        id: 't1',
        name: 'bug',
        color: '#f00',
        workspaceId: 'w1',
        createdAt: new Date(0),
        _count: { taskTags: 3, documentTags: 0 },
      },
    ])
    const res = await getTags(req('/api/tags'))
    const body = await res.json()
    expect(tagService.listTags).toHaveBeenCalledWith('w1')
    expect(body.tags[0]).toMatchObject({ name: 'bug', taskCount: 3 })
  })
})
