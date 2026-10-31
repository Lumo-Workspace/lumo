import { waitlistAdmin } from '@/lib/services/waitlist-admin.service'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { sendEmail } from '@/lib/integrations/email'
import { platformAdminAudit } from '@/lib/services/platform-admin-audit.service'

jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    listWaitlistEntries: jest.fn(),
    findWaitlistEntryById: jest.fn(),
    approveWaitlistEntryIfPending: jest.fn(),
    markWaitlistInvited: jest.fn(),
    findPendingWaitlistIds: jest.fn(),
    dismissWaitlistEntriesIfPending: jest.fn(),
    restoreWaitlistEntryIfDismissed: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/email', () => ({
  ...jest.requireActual('@/lib/integrations/email'),
  sendEmail: jest.fn(),
  isEmailDelivered: (r: { status: string }) => r.status === 'sent',
}))
jest.mock('@/lib/services/platform-admin-audit.service', () => ({
  platformAdminAudit: { record: jest.fn() },
}))
jest.mock('@/lib/config/public-config', () => ({
  resolveAppUrl: () => 'https://app.example.com',
}))

const repo = miscRepository as jest.Mocked<typeof miscRepository>
const send = sendEmail as jest.Mock
const audit = platformAdminAudit.record as jest.Mock
const T = new Date('2026-10-01T00:00:00Z')

const row = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  email: 'a@x.com',
  name: 'Ada',
  company: null,
  teamSize: null,
  source: 'MARKETING_FORM',
  status: 'PENDING',
  createdAt: T,
  approvedAt: null,
  lastInvitedAt: null,
  inviteCount: 0,
  ...over,
})

describe('waitlistAdmin', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    send.mockResolvedValue({ status: 'sent' })
    audit.mockResolvedValue(undefined)
    repo.approveWaitlistEntryIfPending.mockResolvedValue({ count: 1 } as never)
  })

  it('list paginates with a cursor', async () => {
    repo.listWaitlistEntries.mockResolvedValue([
      row({ id: 'a' }),
      row({ id: 'b' }),
      row({ id: 'c' }),
    ] as never)
    const res = await waitlistAdmin.list({ limit: 2, status: 'PENDING' })
    expect(res.items.map(i => i.id)).toEqual(['a', 'b'])
    expect(res.nextCursor).toBe('b')
    expect(repo.listWaitlistEntries).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, status: 'PENDING' })
    )
  })

  it('approve on a PENDING entry sets approvedById and sends', async () => {
    repo.findWaitlistEntryById
      .mockResolvedValueOnce(row() as never)
      .mockResolvedValueOnce(
        row({ status: 'APPROVED', approvedAt: T }) as never
      )
      .mockResolvedValueOnce(
        row({ status: 'APPROVED', approvedAt: T, inviteCount: 1 }) as never
      )
    const res = await waitlistAdmin.approve('w1', 'admin-1')
    expect(repo.approveWaitlistEntryIfPending).toHaveBeenCalledWith(
      'w1',
      'admin-1'
    )
    expect(send).toHaveBeenCalledTimes(1)
    const [msg, opts] = send.mock.calls[0]
    expect(msg.to).toEqual(['a@x.com'])
    expect(msg.html).toContain('https://app.example.com/signin')
    expect(opts.idempotencyKey).toMatch(/^waitlist-approve\/w1-/)
    expect(repo.markWaitlistInvited).toHaveBeenCalledWith('w1')
    expect(res.email).toBe('sent')
    expect(res.entry.status).toBe('APPROVED')
  })

  it('approve twice keeps the first approvedAt and sends no second email', async () => {
    repo.approveWaitlistEntryIfPending.mockResolvedValue({ count: 0 } as never)
    repo.findWaitlistEntryById.mockResolvedValue(
      row({ status: 'APPROVED', approvedAt: T, inviteCount: 1 }) as never
    )
    const res = await waitlistAdmin.approve('w1', 'admin-2')
    // conditional update is the only write path; it is a no-op when approved
    expect(repo.approveWaitlistEntryIfPending).toHaveBeenCalledWith(
      'w1',
      'admin-2'
    )
    expect(send).not.toHaveBeenCalled()
    expect(repo.markWaitlistInvited).not.toHaveBeenCalled()
    expect(res.email).toBe('not_sent')
    expect(res.entry.approvedAt).toEqual(T)
    expect(res.entry.inviteCount).toBe(1)
  })

  it('approve does not bump inviteCount when email is skipped', async () => {
    send.mockResolvedValue({ status: 'skipped', reason: 'not_configured' })
    repo.findWaitlistEntryById.mockResolvedValue(row() as never)
    const res = await waitlistAdmin.approve('w1', 'admin-1')
    expect(res.email).toBe('skipped')
    expect(repo.markWaitlistInvited).not.toHaveBeenCalled()
  })

  it('approve reports failed (approval stands) when the send fails', async () => {
    send.mockResolvedValue({ status: 'failed', error: { code: 'x' } })
    repo.findWaitlistEntryById.mockResolvedValue(row() as never)
    const res = await waitlistAdmin.approve('w1', 'admin-1')
    expect(res.email).toBe('failed')
    expect(repo.markWaitlistInvited).not.toHaveBeenCalled()
  })

  it('approve on unknown id is 404 WAITLIST_NOT_FOUND', async () => {
    repo.findWaitlistEntryById.mockResolvedValue(null)
    await expect(waitlistAdmin.approve('nope', 'a')).rejects.toMatchObject({
      status: 404,
      code: 'WAITLIST_NOT_FOUND',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('resend on a PENDING entry is 409 WAITLIST_NOT_APPROVED', async () => {
    repo.findWaitlistEntryById.mockResolvedValue(row() as never)
    await expect(waitlistAdmin.resend('w1', 'a')).rejects.toMatchObject({
      status: 409,
      code: 'WAITLIST_NOT_APPROVED',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('resend on an APPROVED entry sends and bumps', async () => {
    repo.findWaitlistEntryById.mockResolvedValue(
      row({ status: 'APPROVED', approvedAt: T }) as never
    )
    const res = await waitlistAdmin.resend('w1', 'a')
    expect(res.email).toBe('sent')
    expect(repo.markWaitlistInvited).toHaveBeenCalledWith('w1')
  })

  it('resend on unknown id is 404', async () => {
    repo.findWaitlistEntryById.mockResolvedValue(null)
    await expect(waitlistAdmin.resend('x', 'a')).rejects.toMatchObject({
      status: 404,
      code: 'WAITLIST_NOT_FOUND',
    })
  })

  describe('audit (LUM-1344: written before the email)', () => {
    it('approve audits waitlist.approve with approvedNow before sending', async () => {
      repo.findWaitlistEntryById.mockResolvedValue(row() as never)
      send.mockImplementation(async () => {
        expect(audit).toHaveBeenCalledTimes(1)
        return { status: 'sent' }
      })
      await waitlistAdmin.approve('w1', 'admin-1')
      expect(audit).toHaveBeenCalledWith({
        adminUserId: 'admin-1',
        action: 'waitlist.approve',
        targetType: 'waitlist',
        targetId: 'w1',
        metadata: { approvedNow: true },
      })
    })

    it('approve of an already-approved entry records approvedNow=false', async () => {
      repo.approveWaitlistEntryIfPending.mockResolvedValue({
        count: 0,
      } as never)
      repo.findWaitlistEntryById.mockResolvedValue(
        row({ status: 'APPROVED', approvedAt: T }) as never
      )
      await waitlistAdmin.approve('w1', 'admin-2')
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { approvedNow: false } })
      )
    })

    it('email send throws: audit row still written and approval stands', async () => {
      repo.findWaitlistEntryById.mockResolvedValue(row() as never)
      send.mockRejectedValue(new Error('provider down'))
      await expect(waitlistAdmin.approve('w1', 'admin-1')).rejects.toThrow(
        'provider down'
      )
      expect(repo.approveWaitlistEntryIfPending).toHaveBeenCalledWith(
        'w1',
        'admin-1'
      )
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'waitlist.approve', targetId: 'w1' })
      )
    })

    it('markWaitlistInvited throws: audit row still written', async () => {
      repo.findWaitlistEntryById.mockResolvedValue(row() as never)
      repo.markWaitlistInvited.mockRejectedValue(new Error('db blip'))
      await expect(waitlistAdmin.approve('w1', 'admin-1')).rejects.toThrow(
        'db blip'
      )
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'waitlist.approve' })
      )
    })

    it('resend audits waitlist.resend with the admin before sending', async () => {
      repo.findWaitlistEntryById.mockResolvedValue(
        row({ status: 'APPROVED', approvedAt: T }) as never
      )
      send.mockRejectedValue(new Error('provider down'))
      await expect(waitlistAdmin.resend('w1', 'admin-3')).rejects.toThrow()
      expect(audit).toHaveBeenCalledWith({
        adminUserId: 'admin-3',
        action: 'waitlist.resend',
        targetType: 'waitlist',
        targetId: 'w1',
      })
    })

    it('resend on a PENDING entry writes no audit row', async () => {
      repo.findWaitlistEntryById.mockResolvedValue(row() as never)
      await expect(waitlistAdmin.resend('w1', 'a')).rejects.toMatchObject({
        status: 409,
      })
      expect(audit).not.toHaveBeenCalled()
    })

    it('audit write failure aborts before any email is sent', async () => {
      repo.findWaitlistEntryById.mockResolvedValue(row() as never)
      audit.mockRejectedValue(new Error('audit down'))
      await expect(waitlistAdmin.approve('w1', 'admin-1')).rejects.toThrow(
        'audit down'
      )
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('dismiss / restore', () => {
    it('approve refuses a dismissed entry with 409 and sends nothing', async () => {
      repo.findWaitlistEntryById.mockResolvedValue(
        row({ status: 'DISMISSED' }) as never
      )
      await expect(
        waitlistAdmin.approve('w1', 'admin-1')
      ).rejects.toMatchObject({ status: 409, code: 'WAITLIST_DISMISSED' })
      expect(repo.approveWaitlistEntryIfPending).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
      expect(audit).not.toHaveBeenCalled()
    })

    it('dismiss changes only PENDING ids, dedupes, audits each and sends no email', async () => {
      repo.findPendingWaitlistIds.mockResolvedValue(['w1', 'w3'])
      repo.dismissWaitlistEntriesIfPending.mockResolvedValue({
        count: 2,
      } as never)
      const res = await waitlistAdmin.dismiss(
        ['w1', 'w1', 'w2', 'w3'],
        'admin-1'
      )
      expect(repo.findPendingWaitlistIds).toHaveBeenCalledWith([
        'w1',
        'w2',
        'w3',
      ])
      expect(repo.dismissWaitlistEntriesIfPending).toHaveBeenCalledWith([
        'w1',
        'w3',
      ])
      expect(res).toEqual({ dismissed: ['w1', 'w3'] })
      expect(audit).toHaveBeenCalledTimes(2)
      expect(audit).toHaveBeenCalledWith({
        adminUserId: 'admin-1',
        action: 'waitlist.dismiss',
        targetType: 'waitlist',
        targetId: 'w3',
      })
      expect(send).not.toHaveBeenCalled()
    })

    it('dismiss with nothing PENDING writes and audits nothing', async () => {
      repo.findPendingWaitlistIds.mockResolvedValue([])
      const res = await waitlistAdmin.dismiss(['w9'], 'admin-1')
      expect(res).toEqual({ dismissed: [] })
      expect(repo.dismissWaitlistEntriesIfPending).not.toHaveBeenCalled()
      expect(audit).not.toHaveBeenCalled()
    })

    it('restore moves DISMISSED back to PENDING and audits waitlist.restore', async () => {
      repo.findWaitlistEntryById
        .mockResolvedValueOnce(row({ status: 'DISMISSED' }) as never)
        .mockResolvedValueOnce(row({ status: 'PENDING' }) as never)
      repo.restoreWaitlistEntryIfDismissed.mockResolvedValue({
        count: 1,
      } as never)
      const res = await waitlistAdmin.restore('w1', 'admin-1')
      expect(res.entry.status).toBe('PENDING')
      expect(audit).toHaveBeenCalledWith({
        adminUserId: 'admin-1',
        action: 'waitlist.restore',
        targetType: 'waitlist',
        targetId: 'w1',
      })
    })

    it('restore of an entry that is not dismissed is 409 and not audited', async () => {
      repo.findWaitlistEntryById.mockResolvedValue(row() as never)
      repo.restoreWaitlistEntryIfDismissed.mockResolvedValue({
        count: 0,
      } as never)
      await expect(
        waitlistAdmin.restore('w1', 'admin-1')
      ).rejects.toMatchObject({ status: 409, code: 'WAITLIST_NOT_DISMISSED' })
      expect(audit).not.toHaveBeenCalled()
    })

    it('restore of an unknown id is 404', async () => {
      repo.findWaitlistEntryById.mockResolvedValue(null)
      await expect(waitlistAdmin.restore('nope', 'a')).rejects.toMatchObject({
        status: 404,
      })
    })
  })
})
