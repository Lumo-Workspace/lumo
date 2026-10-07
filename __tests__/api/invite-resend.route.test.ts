/**
 * @jest-environment node
 *
 * LUM-1017 follow-up — POST /api/invites/[token]/resend reports what happened
 * to the email instead of always answering ok: sent → 200 ok, failed → 502
 * EMAIL_SEND_FAILED, skipped (no transport configured) → 503
 * EMAIL_NOT_CONFIGURED. The invite expiry is refreshed in every case.
 */
jest.mock('@/lib/auth', () => ({ requireAuth: jest.fn() }))
jest.mock('@/lib/api/helpers', () => ({ requireUserWorkspace: jest.fn() }))

const mockResendInvite = jest.fn()
jest.mock('@/lib/services/invite.service', () => ({
  inviteService: { resendInvite: (...a: unknown[]) => mockResendInvite(...a) },
}))
const mockResetExpiry = jest.fn()
jest.mock('@/lib/repositories/invite.repository', () => ({
  inviteRepository: { resetExpiry: (...a: unknown[]) => mockResetExpiry(...a) },
}))
const mockSendEmail = jest.fn()
jest.mock('@/lib/integrations/email', () => ({
  ...jest.requireActual('@/lib/integrations/email'),
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { POST } from '@/app/api/invites/[token]/resend/route'

const params = { params: Promise.resolve({ token: 'tok-1' }) }
const req = () =>
  new NextRequest('http://x/api/invites/tok-1/resend', { method: 'POST' })

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'clerk-1' })
  ;(requireUserWorkspace as jest.Mock).mockResolvedValue({
    workspaceId: 'ws-1',
    member: { id: 'm-1' },
    workspace: { slug: 'acme' },
  })
  mockResendInvite.mockResolvedValue({
    id: 'inv-1',
    email: 'bo@acme.test',
    inviterName: 'Ada Lovelace',
    workspace: { name: 'Acme' },
  })
  mockResetExpiry.mockResolvedValue(undefined)
})

describe('POST /api/invites/[token]/resend', () => {
  it('sent → 200 { ok: true } and emails the invitee', async () => {
    mockSendEmail.mockResolvedValue({ status: 'sent', id: 'r1' })
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['bo@acme.test'] }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^workspace-invite-resend\/inv-1-/
        ),
      })
    )
    expect(mockResetExpiry).toHaveBeenCalledWith('inv-1', expect.any(Date))
  })

  it('failed → 502 EMAIL_SEND_FAILED, never ok', async () => {
    mockSendEmail.mockResolvedValue({
      status: 'failed',
      error: {
        name: 'Error',
        message: 'connect ECONNREFUSED',
        code: 'ESOCKET',
      },
    })
    const res = await POST(req(), params)
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body).toMatchObject({ ok: false, code: 'EMAIL_SEND_FAILED' })
    expect(typeof body.error).toBe('string')
    // transport details stay server-side
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED')
    expect(mockResetExpiry).toHaveBeenCalled()
  })

  it('skipped (no transport) → 503 EMAIL_NOT_CONFIGURED', async () => {
    mockSendEmail.mockResolvedValue({
      status: 'skipped',
      reason: 'not_configured',
    })
    const res = await POST(req(), params)
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      ok: false,
      code: 'EMAIL_NOT_CONFIGURED',
    })
  })

  it('a service error keeps its status (e.g. 404) and does not send', async () => {
    mockResendInvite.mockRejectedValue(
      Object.assign(new Error('Invite not found'), { status: 404 })
    )
    const res = await POST(req(), params)
    expect(res.status).toBe(404)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
