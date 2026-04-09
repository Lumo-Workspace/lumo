import { inviteRepository } from '@/lib/repositories/invite.repository'

// ── Mock Prisma ─────────────────────────────────────────────────────────────

const mockDeleteMany = jest.fn()
const mockCreate = jest.fn()
const mockFindMany = jest.fn()
const mockFindUnique = jest.fn()
const mockUpdate = jest.fn()
const mockMemberCreate = jest.fn()
const mockActorCreate = jest.fn()
const mockTeamMemberCreate = jest.fn()
const mockInviteUpdate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceInvite: {
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
      create: (...args: any[]) => mockCreate(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
      update: (...args: any[]) => mockUpdate(...args),
    },
    $transaction: jest.fn((fn: any) =>
      fn({
        workspaceMember: {
          create: (...args: any[]) => mockMemberCreate(...args),
        },
        actor: {
          create: (...args: any[]) => mockActorCreate(...args),
        },
        teamMember: {
          create: (...args: any[]) => mockTeamMemberCreate(...args),
        },
        workspaceInvite: {
          update: (...args: any[]) => mockInviteUpdate(...args),
        },
      })
    ),
  },
}))

beforeEach(() => jest.clearAllMocks())

// ── Tests ───────────────────────────────────────────────────────────────────

describe('inviteRepository', () => {
  describe('deletePendingByEmail', () => {
    it('deletes pending invites for the given email and workspace', async () => {
      mockDeleteMany.mockResolvedValue({ count: 1 })

      await inviteRepository.deletePendingByEmail('ws-1', 'a@b.com')

      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1', email: 'a@b.com', status: 'PENDING' },
      })
    })
  })

  describe('create', () => {
    it('creates an invite with the given data', async () => {
      const data = {
        workspaceId: 'ws-1',
        email: 'a@b.com',
        inviterName: 'Alice',
        invitedById: 'member-1',
        expiresAt: new Date('2026-04-15'),
      }
      mockCreate.mockResolvedValue({ id: 'inv-1', token: 'tok-1', ...data })

      const result = await inviteRepository.create(data)

      expect(result.id).toBe('inv-1')
      expect(mockCreate).toHaveBeenCalledWith({ data })
    })
  })

  describe('findPendingByWorkspace', () => {
    it('returns pending invites ordered by createdAt desc', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'inv-2', email: 'b@c.com' },
        { id: 'inv-1', email: 'a@b.com' },
      ])

      const result = await inviteRepository.findPendingByWorkspace('ws-1')

      expect(result).toHaveLength(2)
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1', status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
        })
      )
    })
  })

  describe('findByToken', () => {
    it('returns invite with workspace info', async () => {
      mockFindUnique.mockResolvedValue({
        status: 'PENDING',
        email: 'a@b.com',
        workspace: { name: 'Test', slug: 'test' },
      })

      const result = await inviteRepository.findByToken('tok-1')

      expect(result?.workspace.name).toBe('Test')
      expect(mockFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token: 'tok-1' },
        })
      )
    })

    it('returns null when not found', async () => {
      mockFindUnique.mockResolvedValue(null)

      const result = await inviteRepository.findByToken('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('updateStatus', () => {
    it('updates invite status', async () => {
      mockUpdate.mockResolvedValue({ id: 'inv-1', status: 'REVOKED' })

      await inviteRepository.updateStatus('inv-1', 'REVOKED')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'REVOKED' },
      })
    })
  })

  describe('acceptInTransaction', () => {
    it('creates member, actor, team membership, and marks invite accepted', async () => {
      mockMemberCreate.mockResolvedValue({ id: 'member-new' })

      const invite = {
        id: 'inv-1',
        workspaceId: 'ws-1',
        workspace: { slug: 'test', teams: [{ id: 'team-1' }] },
      }

      await inviteRepository.acceptInTransaction(invite, 'clerk-1')

      expect(mockMemberCreate).toHaveBeenCalledWith({
        data: {
          workspaceId: 'ws-1',
          clerkId: 'clerk-1',
          role: 'MEMBER',
        },
      })
      expect(mockActorCreate).toHaveBeenCalledWith({
        data: {
          workspaceId: 'ws-1',
          type: 'HUMAN',
          memberId: 'member-new',
        },
      })
      expect(mockTeamMemberCreate).toHaveBeenCalledWith({
        data: { teamId: 'team-1', memberId: 'member-new' },
      })
      expect(mockInviteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: expect.objectContaining({ status: 'ACCEPTED' }),
        })
      )
    })

    it('skips team membership when no default team', async () => {
      mockMemberCreate.mockResolvedValue({ id: 'member-new' })

      const invite = {
        id: 'inv-1',
        workspaceId: 'ws-1',
        workspace: { slug: 'test', teams: [] as Array<{ id: string }> },
      }

      await inviteRepository.acceptInTransaction(invite, 'clerk-1')

      expect(mockTeamMemberCreate).not.toHaveBeenCalled()
    })
  })
})
