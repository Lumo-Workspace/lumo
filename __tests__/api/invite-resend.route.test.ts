/**
 * @jest-environment node
 *
 * LUM-1017 follow-up — POST /api/invites/[token]/resend reports what happened
 * to the email instead of always answering ok, and every failure path
 * (including the catch branch) answers { ok: false, error, code }: sent → 200 ok, failed → 502
 * EMAIL_SEND_FAILED, skipped (no transport configured) → 503
 * EMAIL_NOT_CONFIGURED. Sending and the expiry rule (extended only on sent)
 * live in inviteService.resendInvite — see
 * __tests__/services/invite-resend.service.test.ts.
 */
jest.mock('@/lib/auth', () => ({ requireAuth: jest.fn() }))
jest.mock('@/lib/api/helpers', () => ({ requireUserWorkspace: jest.fn() }))

const mockResendInvite = jest.fn()
jest.mock('@/lib/services/invite.service', () => ({
  inviteService: { resendInvite: (...a: unknown[]) => mockResendInvite(...a) },
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
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
    outcome: 'sent',
    expiresAt: new Date('2026-10-13T00:00:00Z'),
  })
})

describe('POST /api/invites/[token]/resend', () => {
  it('sent → 200 { ok: true }, resending via the service for the caller workspace', async () => {
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockResendInvite).toHaveBeenCalledWith(
      'tok-1',
      'ws-1',
      expect.objectContaining({ source: expect.any(String) })
    )
  })

  it('failed → 502 EMAIL_SEND_FAILED, never ok', async () => {
    mockResendInvite.mockResolvedValue({ outcome: 'failed', expiresAt: null })
    const res = await POST(req(), params)
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body).toMatchObject({ ok: false, code: 'EMAIL_SEND_FAILED' })
    expect(typeof body.error).toBe('string')
  })

  it('skipped (no transport) → 503 EMAIL_NOT_CONFIGURED', async () => {
    mockResendInvite.mockResolvedValue({ outcome: 'skipped', expiresAt: null })
    const res = await POST(req(), params)
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      ok: false,
      code: 'EMAIL_NOT_CONFIGURED',
    })
  })

  it.each([
    [404, 'INVITE_NOT_FOUND', 'Invite not found'],
    [400, 'INVITE_NOT_PENDING', 'Only PENDING invites can be resent'],
  ])(
    'catch: a service error → %i with its code %s',
    async (status, code, message) => {
      mockResendInvite.mockRejectedValue(
        Object.assign(new Error(message), { status, code })
      )
      const res = await POST(req(), params)
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({ ok: false, error: message, code })
    }
  )

  it('catch: a status error without a code gets one from its status', async () => {
    mockResendInvite.mockRejectedValue(
      Object.assign(new Error('nope'), { status: 403 })
    )
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'nope',
      code: 'FORBIDDEN',
    })
  })

  it('catch: an unexpected throw → 500 INTERNAL_ERROR, logged via logger', async () => {
    mockResendInvite.mockRejectedValue(new Error('db down'))
    const res = await POST(req(), params)
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
    })
    expect(JSON.stringify(body)).not.toContain('db down')
    expect(logger.error).toHaveBeenCalledWith(
      'POST /api/invites/[token]/resend error',
      expect.objectContaining({ name: 'Error', message: 'db down' })
    )
  })

  it('auth early return → 401 with code UNAUTHORIZED', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(req(), params)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    })
  })

  it('workspace early return → 404 with code NOT_FOUND', async () => {
    ;(requireUserWorkspace as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    )
    const res = await POST(req(), params)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'No workspace found',
      code: 'NOT_FOUND',
    })
    expect(mockResendInvite).not.toHaveBeenCalled()
  })
})
