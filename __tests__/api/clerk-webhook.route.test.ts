/**
 * @jest-environment node
 *
 * LUM-906 PR2 — POST /api/webhooks/clerk with REAL signature verification
 * (Clerk's verifyWebhook, Standard Webhooks). The signing secret and every
 * signature are generated at runtime; only the deprovisioning service is
 * stubbed (its behaviour is covered against a real database elsewhere).
 */
const mockDeprovision = jest.fn()
jest.mock('@/lib/services/member-deprovision.service', () => {
  const actual = jest.requireActual('@/lib/services/member-deprovision.service')
  return {
    ...actual,
    memberDeprovisionService: {
      deprovisionClerkUser: (...a: unknown[]) => mockDeprovision(...a),
    },
  }
})

import { createHmac, randomBytes } from 'crypto'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/webhooks/clerk/route'
import { deprovisionTriggerFromClerkEvent } from '@/lib/services/member-deprovision.service'

const SECRET_BYTES = randomBytes(32)
const SIGNING_SECRET = ['whsec', SECRET_BYTES.toString('base64')].join('_')

function sign(id: string, timestamp: number, body: string, key = SECRET_BYTES) {
  const mac = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')
  return `v1,${mac}`
}

function webhookRequest(
  payload: unknown,
  opts: { id?: string; signature?: string | null; body?: string } = {}
) {
  const body = opts.body ?? JSON.stringify(payload)
  const id = opts.id ?? 'msg_test_1'
  const ts = Math.floor(Date.now() / 1000)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'svix-id': id,
    'svix-timestamp': String(ts),
  }
  const signature =
    opts.signature === undefined
      ? sign(id, ts, JSON.stringify(payload))
      : opts.signature
  if (signature !== null) headers['svix-signature'] = signature
  return new NextRequest('http://x/api/webhooks/clerk', {
    method: 'POST',
    headers,
    body,
  })
}

const deleted = {
  type: 'user.deleted',
  object: 'event',
  data: { id: 'user_1', object: 'user', deleted: true },
}
const banned = {
  type: 'user.updated',
  object: 'event',
  data: { id: 'user_1', banned: true, locked: false },
}
const locked = {
  type: 'user.updated',
  object: 'event',
  data: { id: 'user_1', banned: false, locked: true },
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET
  mockDeprovision.mockResolvedValue([])
})
afterAll(() => {
  delete process.env.CLERK_WEBHOOK_SIGNING_SECRET
})

describe('LUM-906 Clerk webhook route', () => {
  it('clerk webhook deprovisions on a signed user.deleted with the WEBHOOK context and svix-id', async () => {
    const res = await POST(webhookRequest(deleted, { id: 'msg_del_1' }))

    expect(res.status).toBe(200)
    expect(mockDeprovision).toHaveBeenCalledWith(
      {
        clerkUserId: 'user_1',
        reason: 'CLERK_USER_DELETED',
        webhookId: 'msg_del_1',
      },
      { actor: { type: 'SYSTEM' }, source: 'WEBHOOK' }
    )
  })

  it('clerk webhook deprovisions on a signed user.updated with banned true', async () => {
    const res = await POST(webhookRequest(banned))
    expect(res.status).toBe(200)
    expect(mockDeprovision).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'CLERK_USER_BANNED' }),
      expect.anything()
    )
  })

  it('clerk webhook ignores a locked user without deprovisioning', async () => {
    const res = await POST(webhookRequest(locked))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ignored: 'user.updated' })
    expect(mockDeprovision).not.toHaveBeenCalled()
  })

  it('clerk webhook rejects an unsigned request', async () => {
    const res = await POST(webhookRequest(deleted, { signature: null }))
    expect(res.status).toBe(401)
    expect(mockDeprovision).not.toHaveBeenCalled()
  })

  it('clerk webhook rejects a tampered body', async () => {
    const tampered = JSON.stringify({
      ...deleted,
      data: { ...deleted.data, id: 'user_victim' },
    })
    const res = await POST(webhookRequest(deleted, { body: tampered }))
    expect(res.status).toBe(401)
    expect(mockDeprovision).not.toHaveBeenCalled()
  })

  it('clerk webhook rejects a signature made with another secret', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const forged = sign(
      'msg_test_1',
      ts,
      JSON.stringify(deleted),
      randomBytes(32)
    )
    const res = await POST(webhookRequest(deleted, { signature: forged }))
    expect(res.status).toBe(401)
    expect(mockDeprovision).not.toHaveBeenCalled()
  })

  it('clerk webhook fails closed with 500 when the signing secret is not configured', async () => {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET
    const res = await POST(webhookRequest(deleted))
    expect(res.status).toBe(500)
    expect(mockDeprovision).not.toHaveBeenCalled()
  })

  it('clerk webhook returns 500 so Clerk retries when deprovisioning throws', async () => {
    mockDeprovision.mockRejectedValue(new Error('db down'))
    const res = await POST(webhookRequest(deleted))
    expect(res.status).toBe(500)
  })
})

describe('deprovisionTriggerFromClerkEvent', () => {
  it('clerk trigger maps deleted and banned, ignores everything else', () => {
    expect(deprovisionTriggerFromClerkEvent(deleted, 'w1')).toEqual({
      clerkUserId: 'user_1',
      reason: 'CLERK_USER_DELETED',
      webhookId: 'w1',
    })
    expect(deprovisionTriggerFromClerkEvent(banned, null)?.reason).toBe(
      'CLERK_USER_BANNED'
    )
    expect(deprovisionTriggerFromClerkEvent(locked, null)).toBeNull()
    expect(
      deprovisionTriggerFromClerkEvent(
        { type: 'user.updated', data: { id: 'user_1', banned: false } },
        null
      )
    ).toBeNull()
    expect(
      deprovisionTriggerFromClerkEvent(
        { type: 'user.created', data: { id: 'u' } },
        null
      )
    ).toBeNull()
    expect(
      deprovisionTriggerFromClerkEvent({ type: 'user.deleted', data: {} }, null)
    ).toBeNull()
  })
})
