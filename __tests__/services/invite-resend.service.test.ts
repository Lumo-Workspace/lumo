/**
 * @jest-environment node
 *
 * LUM-1017 follow-up — inviteService.resendInvite extends the invite's
 * expiry only when the email actually went out. A failed or skipped (no
 * transport) send keeps the old expiry, and the `invite.resent` audit event
 * is written after the send with the outcome.
 */
const mockFindByTokenForResend = jest.fn()
const mockResetExpiry = jest.fn()
jest.mock('@/lib/repositories/invite.repository', () => ({
  inviteRepository: {
    findByTokenForResend: (...a: unknown[]) => mockFindByTokenForResend(...a),
    resetExpiry: (...a: unknown[]) => mockResetExpiry(...a),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {},
}))
const mockRecordAuditEvent = jest.fn()
jest.mock('@/lib/services/audit.service', () => ({
  recordAuditEvent: (...a: unknown[]) => mockRecordAuditEvent(...a),
}))
const mockSendEmail = jest.fn()
jest.mock('@/lib/integrations/email', () => ({
  ...jest.requireActual('@/lib/integrations/email'),
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}))

import { inviteService } from '@/lib/services/invite.service'
import type { AuditContext } from '@/lib/services/audit.service'

const audit: AuditContext = {
  source: 'WEB',
  actor: { type: 'MEMBER', clerkId: 'clerk-1', memberId: 'm-1' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindByTokenForResend.mockResolvedValue({
    id: 'inv-1',
    workspaceId: 'ws-1',
    status: 'PENDING',
    email: 'bo@acme.test',
    inviterName: 'Ada Lovelace',
    workspace: { name: 'Acme', slug: 'acme' },
  })
  mockResetExpiry.mockResolvedValue(undefined)
  mockRecordAuditEvent.mockResolvedValue(true)
})

describe('inviteService.resendInvite — expiry follows the send outcome', () => {
  it('sent → emails the invitee, extends the expiry, audits outcome sent', async () => {
    mockSendEmail.mockResolvedValue({ status: 'sent', id: 'r1' })

    const out = await inviteService.resendInvite('tok-1', 'ws-1', audit)

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['bo@acme.test'] }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^workspace-invite-resend\/inv-1-/
        ),
      })
    )
    expect(out.outcome).toBe('sent')
    expect(out.expiresAt).toBeInstanceOf(Date)
    expect(mockResetExpiry).toHaveBeenCalledWith('inv-1', out.expiresAt)
    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      action: 'invite.resent',
      target: { type: 'invite', id: 'inv-1' },
      metadata: { outcome: 'sent', expiresAt: out.expiresAt },
      context: audit,
    })
    // the expiry is extended only after the send answered
    const [sendOrder] = mockSendEmail.mock.invocationCallOrder
    const [resetOrder] = mockResetExpiry.mock.invocationCallOrder
    expect(sendOrder).toBeLessThan(resetOrder ?? 0)
  })

  it('failed → keeps the old expiry, audits outcome failed with the error code', async () => {
    mockSendEmail.mockResolvedValue({
      status: 'failed',
      error: { name: 'Error', message: 'connect refused', code: 'ESOCKET' },
    })

    const out = await inviteService.resendInvite('tok-1', 'ws-1', audit)

    expect(out).toEqual({ outcome: 'failed', expiresAt: null })
    expect(mockResetExpiry).not.toHaveBeenCalled()
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invite.resent',
        metadata: { outcome: 'failed', errorCode: 'ESOCKET' },
      })
    )
  })

  it('skipped (no transport) → keeps the old expiry, audits outcome skipped', async () => {
    mockSendEmail.mockResolvedValue({
      status: 'skipped',
      reason: 'not_configured',
    })

    const out = await inviteService.resendInvite('tok-1', 'ws-1', audit)

    expect(out).toEqual({ outcome: 'skipped', expiresAt: null })
    expect(mockResetExpiry).not.toHaveBeenCalled()
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invite.resent',
        metadata: { outcome: 'skipped' },
      })
    )
  })

  it('skipped as a duplicate key (LUM-1041: the email already went out) → delivered: extends the expiry, audits sent', async () => {
    mockSendEmail.mockResolvedValue({
      status: 'skipped',
      reason: 'duplicate',
      prior: 'sent',
      id: 'm0',
    })

    const out = await inviteService.resendInvite('tok-1', 'ws-1', audit)

    expect(out.outcome).toBe('sent')
    expect(out.expiresAt).toBeInstanceOf(Date)
    expect(mockResetExpiry).toHaveBeenCalledWith('inv-1', out.expiresAt)
  })

  it('a duplicate still in flight elsewhere is not known delivered → failed, old expiry kept', async () => {
    mockSendEmail.mockResolvedValue({
      status: 'skipped',
      reason: 'duplicate',
      prior: 'sending',
      id: null,
    })

    const out = await inviteService.resendInvite('tok-1', 'ws-1', audit)

    expect(out).toEqual({ outcome: 'failed', expiresAt: null })
    expect(mockResetExpiry).not.toHaveBeenCalled()
  })

  it('a non-PENDING invite throws before any send, expiry or audit', async () => {
    mockFindByTokenForResend.mockResolvedValue({
      id: 'inv-1',
      workspaceId: 'ws-1',
      status: 'ACCEPTED',
    })
    await expect(
      inviteService.resendInvite('tok-1', 'ws-1', audit)
    ).rejects.toMatchObject({ status: 400, code: 'INVITE_NOT_PENDING' })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockResetExpiry).not.toHaveBeenCalled()
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })
})
