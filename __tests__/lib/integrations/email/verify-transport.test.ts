/**
 * @jest-environment node
 *
 * LUM-1332 — verifyEmailTransport: signs in to the configured SMTP server
 * without sending anything; never throws, and redacts secrets on failure.
 */
const mockVerify = jest.fn()
jest.mock('nodemailer', () => ({
  ...jest.requireActual('nodemailer'),
  createTransport: () => ({ verify: () => mockVerify() }),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import {
  resetEmailTransportForTests,
  verifyEmailTransport,
} from '@/lib/integrations/email/client'

const VARS = ['RESEND_API_KEY', 'SMTP_URL', 'SMTP_HOST', 'SMTP_PASS']
const saved: Record<string, string | undefined> = {}
const PASS = ['smtp', 'pass', 'fixture'].join('-')

beforeEach(() => {
  for (const k of VARS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  mockVerify.mockReset()
  resetEmailTransportForTests()
})

afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('verifyEmailTransport', () => {
  it('not configured: says so without connecting', async () => {
    expect(await verifyEmailTransport()).toEqual({ status: 'not_configured' })
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('ok when the server accepts the connection and credentials', async () => {
    process.env.SMTP_HOST = 'smtp.example.com'
    mockVerify.mockResolvedValue(true)
    expect(await verifyEmailTransport()).toEqual({
      status: 'ok',
      transport: 'smtp',
    })
  })

  it('a rejected login comes back as a redacted error, not a throw', async () => {
    process.env.SMTP_URL = `smtps://user:${PASS}@smtp.example.com:465`
    mockVerify.mockRejectedValue(
      Object.assign(new Error(`Invalid login for ${PASS}`), {
        code: 'EAUTH',
        responseCode: 535,
      })
    )
    const result = await verifyEmailTransport()
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'EAUTH', statusCode: 535 },
    })
    expect(JSON.stringify(result)).not.toContain(PASS)
  })
})
