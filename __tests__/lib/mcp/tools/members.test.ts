import { makeMemberHandlers } from '@/lib/mcp/tools/members'

const mockListMembers = jest.fn()
const mockGetMember = jest.fn()

jest.mock('@/lib/services/member.service', () => ({
  memberService: {
    listMembers: (...a: any[]) => mockListMembers(...a),
    getMember: (...a: any[]) => mockGetMember(...a),
  },
}))

beforeEach(() => jest.clearAllMocks())

const boundCtx = {
  clerkUserId: 'u1',
  connectionId: 'c1',
  workspaceId: 'ws-1',
  memberId: 'm-1',
  memberRole: 'MEMBER' as const,
}

describe('list_members', () => {
  it('delegates to memberService.listMembers and strips clerkId', async () => {
    mockListMembers.mockResolvedValue([
      {
        id: 'm-1',
        workspaceId: 'ws-1',
        role: 'MEMBER',
        joinedAt: new Date('2024-01-01'),
        actor: { id: 'a-1' },
      },
    ])
    const h = makeMemberHandlers(async () => boundCtx)
    const out = await h.list_members()
    expect(mockListMembers).toHaveBeenCalledWith('ws-1')
    expect(out.members).toHaveLength(1)
    expect(out.members[0]).toEqual({
      id: 'm-1',
      workspaceId: 'ws-1',
      role: 'MEMBER',
      joinedAt: new Date('2024-01-01'),
      actorId: 'a-1',
    })
    // clerkId must not appear in output
    expect(out.members[0]).not.toHaveProperty('clerkId')
  })

  it('throws WORKSPACE_REQUIRED when context has no workspaceId', async () => {
    const bootstrapCtx = { clerkUserId: 'u1', connectionId: 'c1' }
    const h = makeMemberHandlers(async () => bootstrapCtx as any)
    await expect(h.list_members()).rejects.toMatchObject({
      code: 'WORKSPACE_REQUIRED',
    })
  })
})

describe('get_member', () => {
  it('delegates to memberService.getMember with memberId + workspaceId', async () => {
    mockGetMember.mockResolvedValue({
      id: 'm-2',
      workspaceId: 'ws-1',
      role: 'OWNER',
    })
    const h = makeMemberHandlers(async () => boundCtx)
    const out = await h.get_member({ memberId: 'm-2' })
    expect(mockGetMember).toHaveBeenCalledWith('m-2', 'ws-1')
    expect(out.member.id).toBe('m-2')
    expect(out.member).not.toHaveProperty('clerkId')
  })

  it('propagates 404 for cross-workspace or missing member', async () => {
    mockGetMember.mockRejectedValue(
      Object.assign(new Error('Member not found'), { status: 404 })
    )
    const h = makeMemberHandlers(async () => boundCtx)
    await expect(h.get_member({ memberId: 'm-other' })).rejects.toMatchObject({
      status: 404,
    })
  })
})
