/**
 * @jest-environment node
 *
 * LUM-1041 — every email goes over SMTP (nodemailer). Production only sets
 * RESEND_API_KEY, so with no explicit SMTP config that key alone selects
 * Resend's SMTP relay (https://resend.com/docs/send-with-smtp):
 * smtp.resend.com, port 465 implicit TLS, user `resend`, password = API key.
 * An explicit SMTP_URL / SMTP_HOST always wins over the key.
 */
const mockCreateTransport = jest.fn()
jest.mock('nodemailer', () => ({
  ...jest.requireActual('nodemailer'),
  createTransport: (opts: unknown) => mockCreateTransport(opts),
}))
const realNodemailer = jest.requireActual('nodemailer')

jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

// The idempotency claim needs the database; a minimal in-memory stand-in for
// the email_deliveries table (the real-Postgres suite covers the real thing).
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    emailDelivery: {
      create: jest.fn(async () => ({ attempts: 1 })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  },
}))

import { readFileSync } from 'fs'
import path from 'path'
import * as client from '@/lib/integrations/email/client'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/db/prisma'

const {
  SMTP_TIMEOUTS,
  resetEmailTransportForTests,
  resolveEmailTransport,
  sendEmail,
  smtpTransportOptions,
} = client

/** Built at runtime so no key-shaped literal sits in the source. */
const FAKE_KEY = ['re', 'test', 'relay', 'fixture'].join('_')

const VARS = ['RESEND_API_KEY', 'SMTP_URL', 'SMTP_HOST', 'SMTP_PORT']
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of VARS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  resetEmailTransportForTests()
  jest.clearAllMocks()
  mockCreateTransport.mockReset()
  mockCreateTransport.mockImplementation(() =>
    realNodemailer.createTransport({ jsonTransport: true })
  )
})
afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('transport resolution', () => {
  it('RESEND_API_KEY alone → the Resend SMTP relay', () => {
    expect(resolveEmailTransport({ RESEND_API_KEY: 're_x' })).toBe(
      'resend_relay'
    )
  })
  it('explicit SMTP_URL / SMTP_HOST wins over RESEND_API_KEY', () => {
    expect(
      resolveEmailTransport({ RESEND_API_KEY: 're_x', SMTP_HOST: 'mail' })
    ).toBe('smtp')
    expect(
      resolveEmailTransport({ RESEND_API_KEY: 're_x', SMTP_URL: 'smtp://m' })
    ).toBe('smtp')
  })
  it('nothing set → none', () => {
    expect(resolveEmailTransport({})).toBe('none')
  })
})

describe('relay transport options', () => {
  it('RESEND_API_KEY alone → smtp.resend.com:465, implicit TLS, user resend, pass = key', () => {
    expect(smtpTransportOptions({ RESEND_API_KEY: FAKE_KEY })).toEqual({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: FAKE_KEY },
      ...SMTP_TIMEOUTS,
    })
  })
  it('explicit SMTP_HOST config is used as-is, the key is not', () => {
    expect(
      smtpTransportOptions({ RESEND_API_KEY: FAKE_KEY, SMTP_HOST: 'mail' })
    ).toEqual({ host: 'mail', port: 587, secure: false, ...SMTP_TIMEOUTS })
  })
})

describe('sendEmail over the relay', () => {
  const MSG = { to: ['bo@acme.test'], subject: 'Hi', html: '<p>x</p>' }

  it('connects nodemailer to the relay and sends; no other provider path', async () => {
    process.env.RESEND_API_KEY = FAKE_KEY
    const out = await sendEmail(MSG)
    expect(out.status).toBe('sent')
    expect(mockCreateTransport).toHaveBeenCalledTimes(1)
    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: FAKE_KEY },
      ...SMTP_TIMEOUTS,
    })
  })

  it('passes the idempotency key to Resend as the Resend-Idempotency-Key header', async () => {
    process.env.RESEND_API_KEY = FAKE_KEY
    const json = realNodemailer.createTransport({ jsonTransport: true })
    const spy = jest.spyOn(json, 'sendMail')
    mockCreateTransport.mockReturnValue(json)

    await sendEmail(MSG, { idempotencyKey: 'workspace-invite/inv1' })

    expect(spy.mock.calls[0]![0]).toMatchObject({
      headers: { 'Resend-Idempotency-Key': 'workspace-invite/inv1' },
    })
  })

  it('a generic SMTP server never gets the Resend header', async () => {
    process.env.SMTP_HOST = 'mail.internal'
    const json = realNodemailer.createTransport({ jsonTransport: true })
    const spy = jest.spyOn(json, 'sendMail')
    mockCreateTransport.mockReturnValue(json)

    await sendEmail(MSG, { idempotencyKey: 'k' })

    expect(spy.mock.calls[0]![0]).not.toHaveProperty('headers')
  })

  it('an SMTP auth failure → failed with the SMTP code + reply code, key redacted', async () => {
    process.env.RESEND_API_KEY = FAKE_KEY
    mockCreateTransport.mockReturnValue({
      sendMail: () =>
        Promise.reject(
          Object.assign(
            new Error(`Invalid login: 535 Authentication failed ${FAKE_KEY}`),
            { code: 'EAUTH', responseCode: 535, response: `535 ${FAKE_KEY}` }
          )
        ),
    })
    const out = await sendEmail(MSG)
    expect(out).toEqual({
      status: 'failed',
      error: {
        name: 'Error',
        message: 'Invalid login: 535 Authentication failed ***',
        code: 'EAUTH',
        statusCode: 535,
      },
    })
    const logged = JSON.stringify((logger.error as jest.Mock).mock.calls)
    expect(logged).toContain('"transport":"resend_relay"')
    expect(logged).not.toContain(FAKE_KEY)
  })
})

describe('idempotency ledger failures', () => {
  const MSG = { to: ['bo@acme.test'], subject: 'Hi', html: '<p>x</p>' }

  it('ledger unreachable → fails closed with EIDEMPOTENCY and sends nothing', async () => {
    process.env.SMTP_HOST = 'mail.internal'
    ;(prisma.emailDelivery.create as jest.Mock).mockRejectedValueOnce(
      new Error('connection refused')
    )
    const out = await sendEmail(MSG, { idempotencyKey: 'k' })
    expect(out).toEqual({
      status: 'failed',
      error: {
        name: 'EmailIdempotencyError',
        message: 'idempotency ledger unavailable',
        code: 'EIDEMPOTENCY',
      },
    })
    expect(mockCreateTransport).not.toHaveBeenCalled()
  })

  it('recording the outcome fails → the send result still stands', async () => {
    process.env.SMTP_HOST = 'mail.internal'
    ;(prisma.emailDelivery.updateMany as jest.Mock).mockRejectedValueOnce(
      new Error('db gone')
    )
    const out = await sendEmail(MSG, { idempotencyKey: 'k' })
    expect(out.status).toBe('sent')
    expect(logger.error).toHaveBeenCalledWith(
      '[email] could not record delivery outcome',
      expect.objectContaining({ outcome: 'sent' })
    )
  })
})

describe('no Resend SDK', () => {
  const root = path.resolve(__dirname, '../../../..')

  it('`resend` is not a dependency in package.json or the lockfile', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8')
    )
    expect(pkg.dependencies).not.toHaveProperty('resend')
    expect(pkg.devDependencies ?? {}).not.toHaveProperty('resend')
    const lock = JSON.parse(
      readFileSync(path.join(root, 'package-lock.json'), 'utf8')
    )
    expect(lock.packages).not.toHaveProperty(['node_modules/resend'])
  })

  it('the email client source does not import the SDK', () => {
    const src = readFileSync(
      path.join(root, 'lib/integrations/email/client.ts'),
      'utf8'
    )
    expect(src).not.toMatch(/from ['"]resend['"]|require\(['"]resend['"]\)/)
  })
})
