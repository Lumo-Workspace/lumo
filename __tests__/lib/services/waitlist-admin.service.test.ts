import { waitlistAdmin } from '@/lib/services/waitlist-admin.service'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { sendEmail } from '@/lib/integrations/email'

jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    listWaitlistEntries: jest.fn(),
    findWaitlistEntryById: jest.fn(),
    approveWaitlistEntryIfPending: jest.fn(),
    markWaitlistInvited: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/email', () => ({
  ...jest.requireActual('@/lib/integrations/email'),
  sendEmail: jest.fn(),
  isEmailDelivered: (r: { status: string }) => r.status === 'sent',
}))
jest.mock('@/lib/config/public-config', () => ({
  resolveAppUrl: () => 'https://app.example.com',
}))

const repo = miscRepository as jest.Mocked<typeof miscRepository>
const send = sendEmail as jest.Mock
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

  it('approve twice keeps the first approvedAt and still sends', async () => {
    repo.findWaitlistEntryById.mockResolvedValue(
      row({ status: 'APPROVED', approvedAt: T }) as never
    )
    const res = await waitlistAdmin.approve('w1', 'admin-2')
    // conditional update is the only write path; it is a no-op when approved
    expect(repo.approveWaitlistEntryIfPending).toHaveBeenCalledWith(
      'w1',
      'admin-2'
    )
    expect(send).toHaveBeenCalledTimes(1)
    expect(res.entry.approvedAt).toEqual(T)
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
})
