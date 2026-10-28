import { memberRepository } from '@/lib/repositories/member.repository'

// ── Mock Prisma ─────────────────────────────────────────────────────────────

const mockMemberFindMany = jest.fn()
const mockMemberFindUnique = jest.fn()
const mockMemberUpdate = jest.fn()
const mockMemberCount = jest.fn()
const mockMemberDelete = jest.fn()
const mockTransaction = jest.fn()
const mockActorFindMany = jest.fn()
const mockAgentFindFirst = jest.fn()
const mockAgentCreate = jest.fn()
const mockActorCreate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: (...args: any[]) => mockTransaction(...args),
    workspaceMember: {
      findMany: (...args: any[]) => mockMemberFindMany(...args),
      findUnique: (...args: any[]) => mockMemberFindUnique(...args),
      update: (...args: any[]) => mockMemberUpdate(...args),
      count: (...args: any[]) => mockMemberCount(...args),
      delete: (...args: any[]) => mockMemberDelete(...args),
    },
    actor: {
      findMany: (...args: any[]) => mockActorFindMany(...args),
      create: (...args: any[]) => mockActorCreate(...args),
    },
    agentProfile: {
      findFirst: (...args: any[]) => mockAgentFindFirst(...args),
      create: (...args: any[]) => mockAgentCreate(...args),
    },
  },
}))

// ── Mock Clerk ──────────────────────────────────────────────────────────────

const mockClerkGetUserList = jest.fn()

jest.mock('@/lib/auth/users', () => ({
  createUserDirectory: async () => ({
    getUserList: (...args: any[]) => mockClerkGetUserList(...args),
  }),
}))

beforeEach(() => jest.clearAllMocks())

// ── Tests ───────────────────────────────────────────────────────────────────

describe('memberRepository', () => {
  describe('findByWorkspace', () => {
    it('queries members ordered by joinedAt asc with actor', async () => {
      mockMemberFindMany.mockResolvedValue([
        { id: 'm-1', actor: { id: 'a-1' } },
      ])

      const result = await memberRepository.findByWorkspace('ws-1')

      expect(result).toHaveLength(1)
      expect(mockMemberFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1', deactivatedAt: null },
          orderBy: { joinedAt: 'asc' },
          include: { actor: { select: { id: true } } },
        })
      )
    })
  })

  describe('findByWorkspaceAndClerkId', () => {
    it('queries by composite unique key', async () => {
      mockMemberFindUnique.mockResolvedValue({ id: 'm-1' })

      const result = await memberRepository.findByWorkspaceAndClerkId(
        'ws-1',
        'clerk-1'
      )

      expect(result?.id).toBe('m-1')
      expect(mockMemberFindUnique).toHaveBeenCalledWith({
        where: {
          workspaceId_clerkId: { workspaceId: 'ws-1', clerkId: 'clerk-1' },
          deactivatedAt: null,
        },
      })
    })
  })

  describe('findById', () => {
    it('returns member with selected fields', async () => {
      mockMemberFindUnique.mockResolvedValue({
        id: 'm-1',
        workspaceId: 'ws-1',
        role: 'MEMBER',
      })

      const result = await memberRepository.findById('m-1')

      expect(result?.role).toBe('MEMBER')
    })
  })

  describe('findClerkIdById', () => {
    it('returns the clerkId for the member', async () => {
      mockMemberFindUnique.mockResolvedValue({ clerkId: 'user_123' })

      const result = await memberRepository.findClerkIdById('m-1')

      expect(result).toBe('user_123')
      expect(mockMemberFindUnique).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        select: { clerkId: true },
      })
    })

    it('returns null when the member is missing', async () => {
      mockMemberFindUnique.mockResolvedValue(null)

      const result = await memberRepository.findClerkIdById('nope')

      expect(result).toBeNull()
    })
  })

  describe('updateRole', () => {
    it('updates member role and returns id + role', async () => {
      mockMemberUpdate.mockResolvedValue({ id: 'm-1', role: 'OWNER' })

      const result = await memberRepository.updateRole('m-1', 'OWNER')

      expect(result.role).toBe('OWNER')
      expect(mockMemberUpdate).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: { role: 'OWNER' },
        select: { id: true, role: true },
      })
    })
  })

  describe('countOwners', () => {
    it('counts OWNER members in workspace', async () => {
      mockMemberCount.mockResolvedValue(2)

      const result = await memberRepository.countOwners('ws-1')

      expect(result).toBe(2)
      expect(mockMemberCount).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1', role: 'OWNER', deactivatedAt: null },
      })
    })
  })

  describe('deactivate (LUM-906)', () => {
    it('marks the row, revokes live keys and drops team memberships in one transaction', async () => {
      const tx = {
        workspaceMember: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        apiKey: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
        teamMember: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      }
      mockTransaction.mockImplementation(async (fn: any) => fn(tx))
      const now = new Date('2026-10-05T00:00:00Z')

      const result = await memberRepository.deactivate('m-1', 'REMOVED', now)

      expect(result).toEqual({ deactivated: true, apiKeysRevoked: 2 })
      expect(tx.workspaceMember.updateMany).toHaveBeenCalledWith({
        where: { id: 'm-1', deactivatedAt: null },
        data: { deactivatedAt: now, deactivationReason: 'REMOVED' },
      })
      expect(tx.apiKey.updateMany).toHaveBeenCalledWith({
        where: { workspaceMemberId: 'm-1', revokedAt: null },
        data: { revokedAt: now },
      })
      expect(tx.teamMember.deleteMany).toHaveBeenCalledWith({
        where: { memberId: 'm-1' },
      })
    })

    it('is a no-op for an already deactivated member', async () => {
      const tx = {
        workspaceMember: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        apiKey: { updateMany: jest.fn() },
        teamMember: { deleteMany: jest.fn() },
      }
      mockTransaction.mockImplementation(async (fn: any) => fn(tx))

      const result = await memberRepository.deactivate('m-1', 'LEFT')

      expect(result).toEqual({ deactivated: false, apiKeysRevoked: 0 })
      expect(tx.apiKey.updateMany).not.toHaveBeenCalled()
      expect(tx.teamMember.deleteMany).not.toHaveBeenCalled()
    })
  })

  describe('findAgentActors', () => {
    it('returns agent actors with profile info', async () => {
      mockActorFindMany.mockResolvedValue([
        {
          id: 'a-1',
          agent: { name: 'Coding Agent', avatarColor: '#fff', type: 'CODING' },
        },
      ])

      const result = await memberRepository.findAgentActors('ws-1')

      expect(result).toHaveLength(1)
      expect(mockActorFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1', type: 'AGENT' },
        })
      )
    })
  })

  describe('createCodingAgent', () => {
    it('creates agent profile and actor', async () => {
      mockAgentCreate.mockResolvedValue({ id: 'agent-1' })

      await memberRepository.createCodingAgent('ws-1')

      expect(mockAgentCreate).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', name: 'Coding Agent', type: 'CODING' },
      })
      expect(mockActorCreate).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', type: 'AGENT', agentId: 'agent-1' },
      })
    })
  })

  describe('findByClerkId', () => {
    it('returns all workspace memberships for a clerk user', async () => {
      const fixture = [
        {
          id: 'm1',
          workspaceId: 'ws-1',
          role: 'OWNER',
          workspace: { id: 'ws-1', name: 'Foo', slug: 'foo' },
        },
        {
          id: 'm2',
          workspaceId: 'ws-2',
          role: 'MEMBER',
          workspace: { id: 'ws-2', name: 'Bar', slug: 'bar' },
        },
      ]
      mockMemberFindMany.mockResolvedValue(fixture)
      const result = await memberRepository.findByClerkId('user_abc')
      expect(mockMemberFindMany).toHaveBeenCalledWith({
        where: { clerkId: 'user_abc', deactivatedAt: null },
        select: {
          id: true,
          workspaceId: true,
          role: true,
          workspace: { select: { id: true, name: true, slug: true } },
        },
      })
      expect(result).toEqual(fixture)
    })
  })

  describe('findActorsByEmailInWorkspace', () => {
    it('returns actor ids for matching emails within the workspace', async () => {
      mockClerkGetUserList.mockResolvedValue({
        data: [
          {
            id: 'clerk-1',
            emailAddresses: [{ emailAddress: 'ada@example.com' }],
          },
        ],
      })
      mockMemberFindMany.mockResolvedValue([
        { clerkId: 'clerk-1', actor: { id: 'actor-1' } },
      ])

      const ids = await memberRepository.findActorsByEmailInWorkspace('ws-1', [
        'ada@example.com',
      ])

      expect(ids).toEqual(['actor-1'])
      expect(mockClerkGetUserList).toHaveBeenCalledWith(
        expect.objectContaining({ emailAddress: ['ada@example.com'] })
      )
      expect(mockMemberFindMany).toHaveBeenCalledWith({
        where: {
          workspaceId: 'ws-1',
          clerkId: { in: ['clerk-1'] },
          deactivatedAt: null,
        },
        select: { clerkId: true, actor: { select: { id: true } } },
      })
    })

    it('returns empty array when no Clerk user matches', async () => {
      mockClerkGetUserList.mockResolvedValue({ data: [] })

      const ids = await memberRepository.findActorsByEmailInWorkspace('ws-1', [
        'x@example.com',
      ])

      expect(ids).toEqual([])
      expect(mockMemberFindMany).not.toHaveBeenCalled()
    })

    it('returns empty array when emails list is empty', async () => {
      const ids = await memberRepository.findActorsByEmailInWorkspace(
        'ws-1',
        []
      )

      expect(ids).toEqual([])
      expect(mockClerkGetUserList).not.toHaveBeenCalled()
      expect(mockMemberFindMany).not.toHaveBeenCalled()
    })

    it('preserves input order of matched emails', async () => {
      mockClerkGetUserList.mockResolvedValue({
        data: [
          {
            id: 'clerk-b',
            emailAddresses: [{ emailAddress: 'b@example.com' }],
          },
          {
            id: 'clerk-a',
            emailAddresses: [{ emailAddress: 'a@example.com' }],
          },
        ],
      })
      mockMemberFindMany.mockResolvedValue([
        { clerkId: 'clerk-a', actor: { id: 'actor-a' } },
        { clerkId: 'clerk-b', actor: { id: 'actor-b' } },
      ])

      const ids = await memberRepository.findActorsByEmailInWorkspace('ws-1', [
        'a@example.com',
        'b@example.com',
      ])

      expect(ids).toEqual(['actor-a', 'actor-b'])
    })

    it('skips Clerk users that do not have a workspace membership', async () => {
      mockClerkGetUserList.mockResolvedValue({
        data: [
          {
            id: 'clerk-1',
            emailAddresses: [{ emailAddress: 'ada@example.com' }],
          },
        ],
      })
      mockMemberFindMany.mockResolvedValue([]) // no member in this workspace

      const ids = await memberRepository.findActorsByEmailInWorkspace('ws-1', [
        'ada@example.com',
      ])

      expect(ids).toEqual([])
    })
  })

  describe('findAllWithProfilesForCli', () => {
    it('returns every member with email, displayName, clerkId, actorId', async () => {
      mockMemberFindMany.mockResolvedValue([
        { id: 'm-1', clerkId: 'clerk-1', actor: { id: 'actor-1' } },
        { id: 'm-2', clerkId: 'clerk-2', actor: { id: 'actor-2' } },
      ])
      mockClerkGetUserList.mockResolvedValue({
        data: [
          {
            id: 'clerk-1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            primaryEmailAddressId: 'e-1',
            emailAddresses: [{ id: 'e-1', emailAddress: 'ada@example.com' }],
          },
          {
            id: 'clerk-2',
            firstName: null,
            lastName: null,
            primaryEmailAddressId: 'e-2',
            emailAddresses: [{ id: 'e-2', emailAddress: 'bob@example.com' }],
          },
        ],
      })

      const result = await memberRepository.findAllWithProfilesForCli('ws-1')

      expect(result).toEqual([
        {
          memberId: 'm-1',
          clerkId: 'clerk-1',
          actorId: 'actor-1',
          email: 'ada@example.com',
          displayName: 'Ada Lovelace',
        },
        {
          memberId: 'm-2',
          clerkId: 'clerk-2',
          actorId: 'actor-2',
          email: 'bob@example.com',
          displayName: 'bob',
        },
      ])
      expect(mockClerkGetUserList).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ['clerk-1', 'clerk-2'] })
      )
    })

    it('skips members with no actor row (defensive)', async () => {
      mockMemberFindMany.mockResolvedValue([
        { id: 'm-1', clerkId: 'clerk-1', actor: null },
        { id: 'm-2', clerkId: 'clerk-2', actor: { id: 'actor-2' } },
      ])
      mockClerkGetUserList.mockResolvedValue({
        data: [
          {
            id: 'clerk-2',
            firstName: 'Bob',
            lastName: null,
            primaryEmailAddressId: 'e-2',
            emailAddresses: [{ id: 'e-2', emailAddress: 'bob@example.com' }],
          },
        ],
      })

      const result = await memberRepository.findAllWithProfilesForCli('ws-1')

      expect(result).toHaveLength(1)
      expect(result[0]?.memberId).toBe('m-2')
    })

    it('returns empty when workspace has no members', async () => {
      mockMemberFindMany.mockResolvedValue([])

      const result = await memberRepository.findAllWithProfilesForCli('ws-1')

      expect(result).toEqual([])
      expect(mockClerkGetUserList).not.toHaveBeenCalled()
    })

    it('returns members with empty profile fields when Clerk has no record', async () => {
      mockMemberFindMany.mockResolvedValue([
        { id: 'm-1', clerkId: 'clerk-1', actor: { id: 'actor-1' } },
      ])
      mockClerkGetUserList.mockResolvedValue({ data: [] })

      const result = await memberRepository.findAllWithProfilesForCli('ws-1')

      expect(result).toEqual([
        {
          memberId: 'm-1',
          clerkId: 'clerk-1',
          actorId: 'actor-1',
          email: '',
          displayName: '',
        },
      ])
    })
  })
})
