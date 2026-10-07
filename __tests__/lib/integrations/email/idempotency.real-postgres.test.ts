/**
 * @jest-environment node
 *
 * LUM-1041 — app-level email idempotency against a REAL Postgres.
 *
 * SMTP has no idempotency, so `sendEmail` claims an `email_deliveries` row
 * (unique idempotencyKey) before it sends. Proven here on a real database —
 * every migration replayed — with the SMTP transport mocked (nodemailer's
 * JSON transport, nothing leaves the process):
 *  - the same key twice → one send, the second is `skipped: duplicate`;
 *  - the same key N times concurrently → exactly one send;
 *  - a failed send → the key may be retried, and then sends;
 *  - a crashed send (SENDING older than the stale window) is reclaimed;
 *  - a fresh SENDING is not;
 *  - no key → no row, every call sends (behaviour before LUM-1041).
 *
 * Database: in-process PGlite by default (so `npm test` needs nothing). Set
 * EMAIL_IDEMPOTENCY_TEST_DATABASE_URL to a migrated Postgres (e.g. a local
 * pgvector/pgvector:pg16 container after `prisma migrate deploy`) to run the
 * same suite over a real server with a multi-connection pool, where the
 * concurrent claims really race.
 */
import { createPgliteHarness } from '../../../../scripts/test-support/pglite-harness'
import type { PrismaClient as PrismaClientType } from '@prisma/client'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const { PrismaPg } =
  jest.requireActual<typeof import('@prisma/adapter-pg')>('@prisma/adapter-pg')

const EXTERNAL_URL = process.env.EMAIL_IDEMPOTENCY_TEST_DATABASE_URL
const harness = EXTERNAL_URL ? null : createPgliteHarness(PrismaClient)
let db: PrismaClientType | null = null

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return db
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

/** Every SMTP send the transport saw, in order. */
const smtpSends: Array<{ to: unknown; headers: unknown }> = []
let sendDelayMs = 0
let failNext = 0
const mockCreateTransport = jest.fn()
jest.mock('nodemailer', () => ({
  ...jest.requireActual('nodemailer'),
  createTransport: (opts: unknown) => mockCreateTransport(opts),
}))
const realNodemailer = jest.requireActual('nodemailer')

import { emailDeliveryRepository } from '@/lib/repositories/email-delivery.repository'
import { logger } from '@/lib/logger'
import {
  EMAIL_CLAIM_STALE_MS,
  resetEmailTransportForTests,
  sendEmail,
} from '@/lib/integrations/email/client'

jest.setTimeout(180_000)

const MSG = { to: ['owner@example.com'], subject: 'Notice', html: '<p>hi</p>' }

beforeAll(async () => {
  if (harness) {
    await harness.start()
    db = harness.prisma
  } else {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: EXTERNAL_URL!, max: 10 }),
    })
  }
})
afterAll(async () => {
  if (harness) await harness.stop()
  else await db?.$disconnect()
})

const savedEnv: Record<string, string | undefined> = {}
const VARS = ['RESEND_API_KEY', 'SMTP_URL', 'SMTP_HOST', 'SMTP_PORT']

beforeEach(async () => {
  for (const k of VARS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  process.env.SMTP_HOST = 'mail.internal'
  resetEmailTransportForTests()
  smtpSends.length = 0
  sendDelayMs = 0
  failNext = 0
  const json = realNodemailer.createTransport({ jsonTransport: true })
  mockCreateTransport.mockReset()
  mockCreateTransport.mockImplementation(() => ({
    async sendMail(mail: { to: unknown; headers?: unknown }) {
      if (sendDelayMs) await new Promise(r => setTimeout(r, sendDelayMs))
      if (failNext > 0) {
        failNext--
        throw Object.assign(new Error('Greeting never received'), {
          code: 'ETIMEDOUT',
        })
      }
      smtpSends.push({ to: mail.to, headers: mail.headers })
      return json.sendMail(mail)
    },
  }))
  await db!.emailDelivery.deleteMany({})
})
afterEach(() => {
  for (const k of VARS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

async function row(key: string) {
  return db!.emailDelivery.findUnique({ where: { idempotencyKey: key } })
}

describe('sendEmail idempotency (real Postgres)', () => {
  it('the same key twice sends once; the second call is skipped as a duplicate', async () => {
    const first = await sendEmail(MSG, { idempotencyKey: 'k/dup' })
    const second = await sendEmail(MSG, { idempotencyKey: 'k/dup' })

    expect(first.status).toBe('sent')
    expect(second).toMatchObject({
      status: 'skipped',
      reason: 'duplicate',
      prior: 'sent',
    })
    expect(smtpSends).toHaveLength(1)
    expect(await row('k/dup')).toMatchObject({
      status: 'SENT',
      attempts: 1,
      errorCode: null,
    })
    expect((await row('k/dup'))!.sentAt).toBeInstanceOf(Date)
  })

  it('the same key 8× concurrently → exactly one SMTP send', async () => {
    sendDelayMs = 150
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        sendEmail(MSG, { idempotencyKey: 'k/concurrent' })
      )
    )
    expect(results.filter(r => r.status === 'sent')).toHaveLength(1)
    expect(
      results.filter(r => r.status === 'skipped' && r.reason === 'duplicate')
    ).toHaveLength(7)
    expect(smtpSends).toHaveLength(1)
    expect(await row('k/concurrent')).toMatchObject({ status: 'SENT' })
  })

  it('a failed send records FAILED + the SMTP code, and a retry may send', async () => {
    failNext = 1
    const first = await sendEmail(MSG, { idempotencyKey: 'k/retry' })
    expect(first).toMatchObject({
      status: 'failed',
      error: { code: 'ETIMEDOUT' },
    })
    expect(await row('k/retry')).toMatchObject({
      status: 'FAILED',
      errorCode: 'ETIMEDOUT',
      attempts: 1,
    })

    const retry = await sendEmail(MSG, { idempotencyKey: 'k/retry' })
    expect(retry.status).toBe('sent')
    expect(smtpSends).toHaveLength(1)
    expect(await row('k/retry')).toMatchObject({
      status: 'SENT',
      errorCode: null,
      attempts: 2,
    })

    const again = await sendEmail(MSG, { idempotencyKey: 'k/retry' })
    expect(again).toMatchObject({ status: 'skipped', reason: 'duplicate' })
    expect(smtpSends).toHaveLength(1)
  })

  it('concurrent retries of a FAILED key → exactly one send', async () => {
    failNext = 1
    await sendEmail(MSG, { idempotencyKey: 'k/failed-race' })
    sendDelayMs = 150
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        sendEmail(MSG, { idempotencyKey: 'k/failed-race' })
      )
    )
    expect(results.filter(r => r.status === 'sent')).toHaveLength(1)
    expect(smtpSends).toHaveLength(1)
  })

  it('a stale SENDING claim (crashed sender) is reclaimed and sent', async () => {
    await db!.emailDelivery.create({
      data: {
        idempotencyKey: 'k/stale',
        status: 'SENDING',
        attemptStartedAt: new Date(Date.now() - EMAIL_CLAIM_STALE_MS - 60_000),
      },
    })
    const out = await sendEmail(MSG, { idempotencyKey: 'k/stale' })
    expect(out.status).toBe('sent')
    expect(smtpSends).toHaveLength(1)
    expect(await row('k/stale')).toMatchObject({ status: 'SENT', attempts: 2 })
  })

  it('repository: a superseded attempt cannot settle the row (markSent / markFailed CAS on attempts)', async () => {
    const t0 = new Date(Date.now() - EMAIL_CLAIM_STALE_MS - 60_000)
    const first = await emailDeliveryRepository.claim('k/cas', new Date(0), t0)
    expect(first).toEqual({ claimed: true, attempt: 1 })
    // attempt 1 is judged stale and reclaimed as attempt 2
    const second = await emailDeliveryRepository.claim(
      'k/cas',
      new Date(Date.now() - EMAIL_CLAIM_STALE_MS)
    )
    expect(second).toEqual({ claimed: true, attempt: 2 })

    // attempt 1 finishes late: neither outcome may land
    expect(await emailDeliveryRepository.markSent('k/cas', 1, 'late-id')).toBe(
      false
    )
    expect(await emailDeliveryRepository.markFailed('k/cas', 1, 'EAUTH')).toBe(
      false
    )
    expect(await row('k/cas')).toMatchObject({
      status: 'SENDING',
      attempts: 2,
      messageId: null,
      sentAt: null,
    })

    expect(await emailDeliveryRepository.markSent('k/cas', 2, 'new-id')).toBe(
      true
    )
    // and a late attempt 1 cannot overwrite attempt 2's SENT either
    expect(await emailDeliveryRepository.markSent('k/cas', 1, 'late-id')).toBe(
      false
    )
    expect(await row('k/cas')).toMatchObject({
      status: 'SENT',
      attempts: 2,
      messageId: 'new-id',
    })
  })

  it("end to end: a stale attempt reclaimed mid-send keeps the newer attempt's record and warns", async () => {
    // attempt 1 hangs in SMTP; meanwhile its claim goes stale and attempt 2 sends
    sendDelayMs = 400
    const slow = sendEmail(MSG, { idempotencyKey: 'k/late' })
    await new Promise(r => setTimeout(r, 100))
    await db!.emailDelivery.update({
      where: { idempotencyKey: 'k/late' },
      data: {
        attemptStartedAt: new Date(Date.now() - EMAIL_CLAIM_STALE_MS - 1000),
      },
    })
    sendDelayMs = 0
    const fast = await sendEmail(MSG, { idempotencyKey: 'k/late' })
    expect(fast.status).toBe('sent')
    const fastId = fast.status === 'sent' ? fast.id : null
    const late = await slow
    expect(late.status).toBe('sent')

    expect(await row('k/late')).toMatchObject({
      status: 'SENT',
      attempts: 2,
      messageId: fastId,
    })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('superseded'),
      expect.objectContaining({ attempt: 1, idempotencyKey: 'k/late' })
    )
  })

  it('a fresh SENDING claim (send in flight elsewhere) is not taken over', async () => {
    await db!.emailDelivery.create({
      data: { idempotencyKey: 'k/inflight', status: 'SENDING' },
    })
    const out = await sendEmail(MSG, { idempotencyKey: 'k/inflight' })
    expect(out).toMatchObject({
      status: 'skipped',
      reason: 'duplicate',
      prior: 'sending',
    })
    expect(smtpSends).toHaveLength(0)
  })

  it('without a key nothing is recorded and every call sends', async () => {
    await sendEmail(MSG)
    await sendEmail(MSG)
    expect(smtpSends).toHaveLength(2)
    expect(await db!.emailDelivery.count()).toBe(0)
  })

  it('not configured → skipped before any claim (no row, so a later configured send still goes)', async () => {
    delete process.env.SMTP_HOST
    resetEmailTransportForTests()
    const out = await sendEmail(MSG, { idempotencyKey: 'k/unconfigured' })
    expect(out).toEqual({ status: 'skipped', reason: 'not_configured' })
    expect(await row('k/unconfigured')).toBeNull()
  })
})
