import { inviteService } from '@/lib/services/invite.service'

// ── Mock dependencies ───────────────────────────────────────────────────────

const mockDeletePendingByEmail = jest.fn()
const mockCreate = jest.fn()
const mockFindPendingByWorkspace = jest.fn()
const mockFindByToken = jest.fn()
const mockFindByTokenForAuth = jest.fn()
const mockFindByTokenWithWorkspace = jest.fn()
const mockFindByTokenForResend = jest.fn()
const mockUpdateStatus = jest.fn()
const mockAcceptInTransaction = jest.fn()
const mockFindPendingByEmails = jest.fn()

jest.mock('@/lib/repositories/invite.repository', () => ({
  inviteRepository: {
    deletePendingByEmail: (...args: any[]) => mockDeletePendingByEmail(...args),
    create: (...args: any[]) => mockCreate(...args),
    findPendingByWorkspace: (...args: any[]) =>
      mockFindPendingByWorkspace(...args),
    findByToken: (...args: any[]) => mockFindByToken(...args),
    findByTokenForAuth: (...args: any[]) => mockFindByTokenForAuth(...args),
    findByTokenWithWorkspace: (...args: any[]) =>
      mockFindByTokenWithWorkspace(...args),
    findByTokenForResend: (...args: any[]) => mockFindByTokenForResend(...args),
    updateStatus: (...args: any[]) => mockUpdateStatus(...args),
    acceptInTransaction: (...args: any[]) => mockAcceptInTransaction(...args),
    findPendingByEmails: (...args: any[]) => mockFindPendingByEmails(...args),
  },
}))

const mockFindByWorkspaceAndClerkId = jest.fn()

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findMembershipStatus: (...args: any[]) =>
      mockFindByWorkspaceAndClerkId(...args),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  // LUM-907: the accepted member's id goes into the audit event.
  mockAcceptInTransaction.mockResolvedValue({ id: 'member-new' })
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('inviteService', () => {
  describe('createInvites', () => {
    it('deletes pending invites and creates new ones for each email', async () => {
      mockCreate
        .mockResolvedValueOnce({ id: 'inv-1', token: 'tok-1' })
        .mockResolvedValueOnce({ id: 'inv-2', token: 'tok-2' })

      const results = await inviteService.createInvites(
        'ws-1',
        ['A@B.com', 'c@d.com'],
        'Alice',
        'member-1',
        new Date('2026-04-15')
      )

      expect(results).toHaveLength(2)
      expect(results[0]!.email).toBe('a@b.com') // lowercased
      expect(mockDeletePendingByEmail).toHaveBeenCalledTimes(2)
      expect(mockCreate).toHaveBeenCalledTimes(2)
    })
  })

  describe('listPendingInvites', () => {
    it('delegates to repository', async () => {
      mockFindPendingByWorkspace.mockResolvedValue([{ id: 'inv-1' }])

      const result = await inviteService.listPendingInvites('ws-1')

      expect(result).toHaveLength(1)
      expect(mockFindPendingByWorkspace).toHaveBeenCalledWith('ws-1')
    })
  })

  describe('getInviteByToken', () => {
    it('returns shaped invite when found', async () => {
      mockFindByToken.mockResolvedValue({
        status: 'PENDING',
        expiresAt: new Date('2099-01-01'),
        email: 'a@b.com',
        inviterName: 'Alice',
        workspace: { name: 'Test', slug: 'test' },
      })

      const result = await inviteService.getInviteByToken('tok-1')

      expect(result.workspaceName).toBe('Test')
      expect(result.status).toBe('PENDING')
      // LUM-906: public endpoint — masked address only.
      expect(result.maskedEmail).toBe('a***@b.com')
      expect(result).not.toHaveProperty('email')
    })

    it('returns EXPIRED status for expired pending invite', async () => {
      mockFindByToken.mockResolvedValue({
        status: 'PENDING',
        expiresAt: new Date('2020-01-01'),
        email: 'a@b.com',
        inviterName: 'Alice',
        workspace: { name: 'Test', slug: 'test' },
      })

      const result = await inviteService.getInviteByToken('tok-1')

      expect(result.status).toBe('EXPIRED')
    })

    it('throws 404 when not found', async () => {
      mockFindByToken.mockResolvedValue(null)

      await expect(
        inviteService.getInviteByToken('nonexistent')
      ).rejects.toMatchObject({
        message: 'Invite not found',
        status: 404,
      })
    })
  })

  describe('revokeInvite', () => {
    it('revokes a pending invite', async () => {
      mockFindByTokenForAuth.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-1',
        status: 'PENDING',
      })

      await inviteService.revokeInvite('tok-1', 'ws-1')

      expect(mockUpdateStatus).toHaveBeenCalledWith('inv-1', 'REVOKED')
    })

    it('throws 404 when invite not in caller workspace', async () => {
      mockFindByTokenForAuth.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-other',
        status: 'PENDING',
      })

      await expect(
        inviteService.revokeInvite('tok-1', 'ws-1')
      ).rejects.toMatchObject({ status: 404 })
    })

    it('throws 400 when invite is not PENDING', async () => {
      mockFindByTokenForAuth.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-1',
        status: 'ACCEPTED',
      })

      await expect(
        inviteService.revokeInvite('tok-1', 'ws-1')
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('acceptInvite', () => {
    it('accepts invite and returns workspace slug', async () => {
      mockFindByTokenWithWorkspace.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-1',
        status: 'PENDING',
        expiresAt: new Date('2099-01-01'),
        email: 'invitee@acme.com',
        workspace: { slug: 'test', teams: [{ id: 'team-1' }] },
      })
      mockFindByWorkspaceAndClerkId.mockResolvedValue(null)

      const result = await inviteService.acceptInvite('tok-1', 'clerk-1', [
        'invitee@acme.com',
      ])

      expect(result.workspaceSlug).toBe('test')
      expect(result.alreadyMember).toBe(false)
      expect(mockAcceptInTransaction).toHaveBeenCalled()
    })

    it('returns idempotently when already a member', async () => {
      mockFindByTokenWithWorkspace.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-1',
        status: 'PENDING',
        expiresAt: new Date('2099-01-01'),
        workspace: { slug: 'test', teams: [] },
      })
      mockFindByWorkspaceAndClerkId.mockResolvedValue({
        id: 'member-1',
        deactivatedAt: null,
      })

      const result = await inviteService.acceptInvite('tok-1', 'clerk-1', [])

      expect(result.alreadyMember).toBe(true)
      expect(mockAcceptInTransaction).not.toHaveBeenCalled()
    })

    it('throws 409 when invite is not PENDING', async () => {
      mockFindByTokenWithWorkspace.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-1',
        status: 'ACCEPTED',
        expiresAt: new Date('2099-01-01'),
        workspace: { slug: 'test', teams: [] },
      })

      await expect(
        inviteService.acceptInvite('tok-1', 'clerk-1', [])
      ).rejects.toMatchObject({ status: 409 })
    })

    it('throws 410 when invite is expired', async () => {
      mockFindByTokenWithWorkspace.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-1',
        status: 'PENDING',
        expiresAt: new Date('2020-01-01'),
        workspace: { slug: 'test', teams: [] },
      })

      await expect(
        inviteService.acceptInvite('tok-1', 'clerk-1', [])
      ).rejects.toMatchObject({ status: 410 })
    })
  })

  // The send / expiry / audit outcome paths are in
  // __tests__/services/invite-resend.service.test.ts (LUM-1017).
  describe('resendInvite', () => {
    it('throws 404 when invite not in caller workspace', async () => {
      mockFindByTokenForResend.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-other',
        status: 'PENDING',
      })

      await expect(
        inviteService.resendInvite('tok-1', 'ws-1')
      ).rejects.toMatchObject({ status: 404, code: 'INVITE_NOT_FOUND' })
    })

    it('throws 400 when invite is not PENDING', async () => {
      mockFindByTokenForResend.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-1',
        status: 'ACCEPTED',
      })

      await expect(
        inviteService.resendInvite('tok-1', 'ws-1')
      ).rejects.toMatchObject({ status: 400, code: 'INVITE_NOT_PENDING' })
    })
  })

  describe('joinPendingInvitesForEmails', () => {
    const invite = (id: string, workspaceId: string, slug: string) => ({
      id,
      workspaceId,
      workspace: { slug, teams: [{ id: `team-${workspaceId}` }] },
    })

    it('joins the workspace of a pending invite and returns its slug', async () => {
      const inv = invite('inv-1', 'ws-1', 'acme')
      mockFindPendingByEmails.mockResolvedValue([inv])
      mockFindByWorkspaceAndClerkId.mockResolvedValue(null)

      const slug = await inviteService.joinPendingInvitesForEmails('clerk-1', [
        'Bob@Acme.com',
      ])

      expect(slug).toBe('acme')
      expect(mockFindPendingByEmails).toHaveBeenCalledWith(
        ['bob@acme.com'],
        expect.any(Date)
      )
      expect(mockAcceptInTransaction).toHaveBeenCalledWith(inv, 'clerk-1', null)
    })

    it('accepts every matching invite and lands on the newest one', async () => {
      mockFindPendingByEmails.mockResolvedValue([
        invite('inv-new', 'ws-new', 'newest'),
        invite('inv-old', 'ws-old', 'older'),
      ])
      mockFindByWorkspaceAndClerkId.mockResolvedValue(null)

      const slug = await inviteService.joinPendingInvitesForEmails('clerk-1', [
        'a@x.com',
        'b@y.com',
      ])

      expect(slug).toBe('newest')
      expect(mockAcceptInTransaction).toHaveBeenCalledTimes(2)
    })

    it('marks the invite accepted without a second membership when already a member', async () => {
      mockFindPendingByEmails.mockResolvedValue([
        invite('inv-1', 'ws-1', 'acme'),
      ])
      mockFindByWorkspaceAndClerkId.mockResolvedValue({
        id: 'member-1',
        deactivatedAt: null,
      })

      const slug = await inviteService.joinPendingInvitesForEmails('clerk-1', [
        'bob@acme.com',
      ])

      expect(slug).toBe('acme')
      expect(mockAcceptInTransaction).not.toHaveBeenCalled()
      expect(mockUpdateStatus).toHaveBeenCalledWith('inv-1', 'ACCEPTED', {
        acceptedAt: expect.any(Date),
      })
    })

    it('returns null when no pending invite matches', async () => {
      mockFindPendingByEmails.mockResolvedValue([])

      const slug = await inviteService.joinPendingInvitesForEmails('clerk-1', [
        'nobody@x.com',
      ])

      expect(slug).toBeNull()
      expect(mockAcceptInTransaction).not.toHaveBeenCalled()
    })

    it('does not query at all without a verified email', async () => {
      const slug = await inviteService.joinPendingInvitesForEmails(
        'clerk-1',
        []
      )

      expect(slug).toBeNull()
      expect(mockFindPendingByEmails).not.toHaveBeenCalled()
    })
  })
})
