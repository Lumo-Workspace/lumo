/**
 * @jest-environment node
 *
 * LUM-906 PR1 — an invite is bound to the address it was sent to. Accepting
 * requires one of the signed-in user's IdP-verified emails to equal
 * invite.email (case-insensitive); holding the link is no longer enough.
 * The first case fails on the pre-fix service, which never looked at the
 * caller's emails and joined whoever held the token.
 */
import { inviteService } from '@/lib/services/invite.service'
import { INVITE_EMAIL_MISMATCH, maskEmail } from '@/lib/utils/invite'

const mockFindByTokenWithWorkspace = jest.fn()
const mockAcceptInTransaction = jest.fn()
const mockFindPendingByEmails = jest.fn()
const mockUpdateStatus = jest.fn()
const mockFindByWorkspaceAndClerkId = jest.fn()
const mockRecordAuditEvent = jest.fn()

jest.mock('@/lib/repositories/invite.repository', () => ({
  inviteRepository: {
    findByTokenWithWorkspace: (...a: unknown[]) =>
      mockFindByTokenWithWorkspace(...a),
    acceptInTransaction: (...a: unknown[]) => mockAcceptInTransaction(...a),
    findPendingByEmails: (...a: unknown[]) => mockFindPendingByEmails(...a),
    updateStatus: (...a: unknown[]) => mockUpdateStatus(...a),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findMembershipStatus: (...a: unknown[]) =>
      mockFindByWorkspaceAndClerkId(...a),
  },
}))
jest.mock('@/lib/services/audit.service', () => ({
  recordAuditEvent: (...a: unknown[]) => mockRecordAuditEvent(...a),
}))

const AUDIT = { actor: { type: 'MEMBER' as const }, source: 'WEB' as const }

function pendingInvite(email = 'alice@acme.com') {
  return {
    id: 'inv-1',
    workspaceId: 'ws-1',
    status: 'PENDING',
    email,
    expiresAt: new Date('2099-01-01'),
    workspace: { slug: 'acme', teams: [] },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindByWorkspaceAndClerkId.mockResolvedValue(null)
  mockAcceptInTransaction.mockResolvedValue({ id: 'member-new' })
})

describe('LUM-906 invite email binding', () => {
  it('invite binding rejects a signed-in user whose verified emails do not include the invited address', async () => {
    mockFindByTokenWithWorkspace.mockResolvedValue(pendingInvite())

    await expect(
      inviteService.acceptInvite(
        'tok-1',
        'clerk-mallory',
        ['mallory@evil.test'],
        AUDIT
      )
    ).rejects.toMatchObject({
      status: 403,
      code: INVITE_EMAIL_MISMATCH,
      maskedEmail: 'a***@acme.com',
    })
    expect(mockAcceptInTransaction).not.toHaveBeenCalled()
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('invite binding rejects a user with no verified email at all', async () => {
    mockFindByTokenWithWorkspace.mockResolvedValue(pendingInvite())

    await expect(
      inviteService.acceptInvite('tok-1', 'clerk-x', [], AUDIT)
    ).rejects.toMatchObject({ status: 403, code: INVITE_EMAIL_MISMATCH })
    expect(mockAcceptInTransaction).not.toHaveBeenCalled()
  })

  it('invite binding accepts the invited address among several verified emails', async () => {
    mockFindByTokenWithWorkspace.mockResolvedValue(pendingInvite())

    const result = await inviteService.acceptInvite(
      'tok-1',
      'clerk-alice',
      ['alice@personal.test', 'alice@acme.com'],
      AUDIT
    )

    expect(result).toEqual({ workspaceSlug: 'acme', alreadyMember: false })
    expect(mockAcceptInTransaction).toHaveBeenCalledTimes(1)
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invite.accepted' })
    )
  })

  it('invite binding compares addresses case-insensitively in both directions', async () => {
    mockFindByTokenWithWorkspace.mockResolvedValue(
      pendingInvite('Alice@Acme.com')
    )
    const result = await inviteService.acceptInvite(
      'tok-1',
      'clerk-alice',
      ['ALICE@acme.COM'],
      AUDIT
    )

    expect(result).toEqual({ workspaceSlug: 'acme', alreadyMember: false })
    expect(mockAcceptInTransaction).toHaveBeenCalledTimes(1)
  })

  it('invite binding lets an existing member land on the workspace whatever their email', async () => {
    mockFindByTokenWithWorkspace.mockResolvedValue(pendingInvite())
    mockFindByWorkspaceAndClerkId.mockResolvedValue({
      id: 'member-1',
      deactivatedAt: null,
    })

    const result = await inviteService.acceptInvite(
      'tok-1',
      'clerk-member',
      ['someone-else@acme.com'],
      AUDIT
    )

    expect(result).toEqual({ workspaceSlug: 'acme', alreadyMember: true })
    expect(mockAcceptInTransaction).not.toHaveBeenCalled()
  })

  it('invite binding keeps joinPendingInvitesForEmails joining on verified emails', async () => {
    mockFindPendingByEmails.mockResolvedValue([pendingInvite()])

    const slug = await inviteService.joinPendingInvitesForEmails(
      'clerk-alice',
      ['Alice@Acme.com'],
      AUDIT
    )

    expect(slug).toBe('acme')
    expect(mockFindPendingByEmails).toHaveBeenCalledWith(
      ['alice@acme.com'],
      expect.any(Date)
    )
    expect(mockAcceptInTransaction).toHaveBeenCalledTimes(1)
  })
})

describe('maskEmail', () => {
  it('maskEmail keeps the first character and the domain', () => {
    expect(maskEmail('alice@acme.com')).toBe('a***@acme.com')
    expect(maskEmail('a@acme.com')).toBe('a***@acme.com')
  })

  it('maskEmail masks malformed input completely', () => {
    expect(maskEmail('not-an-email')).toBe('***')
    expect(maskEmail('@acme.com')).toBe('***')
    expect(maskEmail('alice@')).toBe('***')
    expect(maskEmail('')).toBe('***')
  })
})
