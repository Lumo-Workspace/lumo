/**
 * @jest-environment node
 *
 * LUM-1017 — pluggable email transport: Resend, SMTP (nodemailer), or
 * unconfigured (log + no-op, never throws).
 */
const mockResendSend = jest.fn()
jest.mock('resend', () => ({
  Resend: jest
    .fn()
    .mockImplementation(() => ({ emails: { send: mockResendSend } })),
}))

// nodemailer.createTransport is routed through this mock; by default it
// returns nodemailer's real JSON transport, whose sendMail builds the full
// message (no socket) and hands it back.
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

import {
  DEFAULT_EMAIL_FROM,
  SMTP_TIMEOUTS,
  redactEmailSecrets,
  resetEmailTransportForTests,
  toEmailError,
  resolveEmailFrom,
  resolveEmailTransport,
  sendEmail,
  smtpTransportOptions,
} from '@/lib/integrations/email/client'
import { buildInviteEmail } from '@/lib/integrations/email'
import { logger } from '@/lib/logger'

const EMAIL_VARS = [
  'RESEND_API_KEY',
  'SMTP_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_SECURE',
  'EMAIL_FROM',
]
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of EMAIL_VARS) {
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
  for (const k of EMAIL_VARS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('resolveEmailTransport', () => {
  it('picks resend when RESEND_API_KEY is set, even if SMTP is too', () => {
    expect(
      resolveEmailTransport({ RESEND_API_KEY: 're_x', SMTP_HOST: 'mail' })
    ).toBe('resend')
  })
  it('picks smtp from SMTP_URL or SMTP_HOST', () => {
    expect(resolveEmailTransport({ SMTP_URL: 'smtp://mail:25' })).toBe('smtp')
    expect(resolveEmailTransport({ SMTP_HOST: 'mail' })).toBe('smtp')
  })
  it('is none when nothing is configured', () => {
    expect(resolveEmailTransport({})).toBe('none')
  })
})

describe('resolveEmailFrom', () => {
  it('uses EMAIL_FROM, else the Lumo default', () => {
    expect(resolveEmailFrom({ EMAIL_FROM: 'Ops <ops@corp.test>' })).toBe(
      'Ops <ops@corp.test>'
    )
    expect(resolveEmailFrom({})).toBe(DEFAULT_EMAIL_FROM)
  })
})

describe('smtpTransportOptions', () => {
  it('passes SMTP_URL through as the url option, with timeouts', () => {
    expect(smtpTransportOptions({ SMTP_URL: 'smtps://u:p@mail:465' })).toEqual({
      url: 'smtps://u:p@mail:465',
      ...SMTP_TIMEOUTS,
    })
  })
  it('builds host/port/secure/auth from discrete vars', () => {
    expect(
      smtpTransportOptions({
        SMTP_HOST: 'mail',
        SMTP_PORT: '465',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
      })
    ).toEqual({
      host: 'mail',
      port: 465,
      secure: true,
      auth: { user: 'u', pass: 'p' },
      ...SMTP_TIMEOUTS,
    })
  })
  it('defaults to 587 without TLS-on-connect and no auth', () => {
    expect(smtpTransportOptions({ SMTP_HOST: 'mail' })).toEqual({
      host: 'mail',
      port: 587,
      secure: false,
      ...SMTP_TIMEOUTS,
    })
  })
  it('bounds connect/greeting/socket waits (10s/10s/30s)', () => {
    expect(SMTP_TIMEOUTS).toEqual({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    })
    expect(smtpTransportOptions({ SMTP_HOST: 'mail' })).toMatchObject(
      SMTP_TIMEOUTS
    )
  })
  it.each(['abc', '0', '-1', '65536', '99999', '25.5'])(
    'falls back to 587 with a warning when SMTP_PORT=%s',
    raw => {
      expect(
        smtpTransportOptions({ SMTP_HOST: 'mail', SMTP_PORT: raw })
      ).toMatchObject({ port: 587, secure: false })
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SMTP_PORT'),
        expect.objectContaining({ smtpPort: raw, defaultPort: 587 })
      )
    }
  )
  it.each(['1', '25', '65535'])('accepts SMTP_PORT=%s', raw => {
    expect(
      smtpTransportOptions({ SMTP_HOST: 'mail', SMTP_PORT: raw })
    ).toMatchObject({ port: Number(raw) })
    expect(logger.warn).not.toHaveBeenCalled()
  })
  it('SMTP_SECURE overrides the port default', () => {
    expect(
      smtpTransportOptions({
        SMTP_HOST: 'mail',
        SMTP_PORT: '1025',
        SMTP_SECURE: 'true',
      })
    ).toMatchObject({ port: 1025, secure: true })
  })
  it.each(['true', 'TRUE', 'True', '1', 'yes', ' true '])(
    'SMTP_SECURE=%p is case-insensitive true',
    raw => {
      expect(
        smtpTransportOptions({ SMTP_HOST: 'mail', SMTP_SECURE: raw })
      ).toMatchObject({ port: 587, secure: true })
    }
  )
  it.each(['false', 'FALSE', '0', 'no'])('SMTP_SECURE=%p is false', raw => {
    expect(
      smtpTransportOptions({
        SMTP_HOST: 'mail',
        SMTP_PORT: '465',
        SMTP_SECURE: raw,
      })
    ).toMatchObject({ port: 465, secure: false })
  })
  it.each([
    [{ SMTP_USER: 'u' }, { hasUser: true, hasPass: false }],
    [{ SMTP_PASS: 'p' }, { hasUser: false, hasPass: true }],
  ])('only one of user/pass (%p) → no auth + warning', (vars, flags) => {
    const opts = smtpTransportOptions({ SMTP_HOST: 'mail', ...vars })
    expect(opts).not.toHaveProperty('auth')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('SMTP_USER / SMTP_PASS'),
      flags
    )
    // the warning never carries the value itself
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toMatch(
      /"u"|"p"/
    )
  })
})

describe('toEmailError', () => {
  it('keeps only name/message/code/statusCode from any error shape', () => {
    expect(
      toEmailError(
        Object.assign(new Error('boom'), {
          code: 'EAUTH',
          extra: { pass: 'x' },
        }),
        {}
      )
    ).toEqual({ name: 'Error', message: 'boom', code: 'EAUTH' })
    expect(
      toEmailError(
        { name: 'rate_limit_exceeded', message: 'slow down', statusCode: 429 },
        {}
      )
    ).toEqual({
      name: 'rate_limit_exceeded',
      message: 'slow down',
      code: 'rate_limit_exceeded',
      statusCode: 429,
    })
    expect(toEmailError('plain string', {})).toEqual({
      name: 'Error',
      message: 'plain string',
    })
  })
})

describe('redactEmailSecrets', () => {
  it('masks RESEND_API_KEY', () => {
    expect(
      redactEmailSecrets('bad key re_abc123', { RESEND_API_KEY: 're_abc123' })
    ).toBe('bad key ***')
  })

  it('masks SMTP_PASS and SMTP_URL userinfo', () => {
    const env = {
      SMTP_PASS: 's3cr3t-pw',
      SMTP_URL: 'smtps://bob:url%2Fpw@mail:465',
    }
    const out = redactEmailSecrets(
      'auth s3cr3t-pw failed for smtps://bob:url%2Fpw@mail:465 (url/pw)',
      env
    )
    expect(out).not.toContain('s3cr3t-pw')
    expect(out).not.toContain('url%2Fpw')
    expect(out).not.toContain('url/pw')
    expect(out).toContain('smtps://***@mail:465')
  })
  it('leaves text without secrets unchanged', () => {
    expect(redactEmailSecrets('connect ETIMEDOUT 10.0.0.1:25', {})).toBe(
      'connect ETIMEDOUT 10.0.0.1:25'
    )
  })
})

describe('sendEmail', () => {
  const invite = buildInviteEmail({
    workspaceName: 'Acme',
    inviterName: 'Ada Lovelace',
    inviterFirstName: 'Ada',
    inviterEmail: 'ada@acme.test',
    inviteUrl: 'https://lumo.example.test/invite/tok123',
  })

  it('resend mode: sends via Resend with the idempotency key', async () => {
    process.env.RESEND_API_KEY = 're_test'
    mockResendSend.mockResolvedValue({ data: { id: 'r1' }, error: null })

    const out = await sendEmail(
      { to: ['bo@acme.test'], subject: invite.subject, html: invite.html },
      { idempotencyKey: 'k1' }
    )

    expect(out).toEqual({ status: 'sent', id: 'r1' })
    expect(mockResendSend).toHaveBeenCalledWith(
      {
        from: DEFAULT_EMAIL_FROM,
        to: ['bo@acme.test'],
        subject: invite.subject,
        html: invite.html,
      },
      { idempotencyKey: 'k1' }
    )
    expect(mockCreateTransport).not.toHaveBeenCalled()
  })

  it('resend mode: an API error comes back as failed with its code, not thrown', async () => {
    process.env.RESEND_API_KEY = 're_test'
    mockResendSend.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'bad to', statusCode: 422 },
    })
    await expect(
      sendEmail({ to: ['x'], subject: 's', html: 'h' })
    ).resolves.toEqual({
      status: 'failed',
      error: {
        name: 'validation_error',
        message: 'bad to',
        code: 'validation_error',
        statusCode: 422,
      },
    })
    expect(logger.error).toHaveBeenCalledWith('[email] send failed', {
      transport: 'resend',
      name: 'validation_error',
      message: 'bad to',
      code: 'validation_error',
      statusCode: 422,
    })
  })

  it('resend mode: the API key is redacted from the failure result and log', async () => {
    process.env.RESEND_API_KEY = 're_live_SUPERSECRETKEY'
    mockResendSend.mockResolvedValue({
      data: null,
      error: {
        name: 'invalid_api_key',
        message: 'API key re_live_SUPERSECRETKEY is invalid',
        statusCode: 403,
      },
    })
    const out = await sendEmail({ to: ['x'], subject: 's', html: 'h' })
    expect(out).toEqual({
      status: 'failed',
      error: {
        name: 'invalid_api_key',
        message: 'API key *** is invalid',
        code: 'invalid_api_key',
        statusCode: 403,
      },
    })
    expect(
      JSON.stringify((logger.error as jest.Mock).mock.calls)
    ).not.toContain('SUPERSECRETKEY')
  })

  it('resend mode: a thrown SDK error goes through the same redacted shape', async () => {
    process.env.RESEND_API_KEY = 're_live_THROWNKEY'
    mockResendSend.mockRejectedValue(
      Object.assign(new TypeError('fetch failed for re_live_THROWNKEY'), {
        code: 'ECONNRESET',
        config: { headers: { Authorization: 'Bearer re_live_THROWNKEY' } },
      })
    )
    const out = await sendEmail({ to: ['x'], subject: 's', html: 'h' })
    expect(out).toEqual({
      status: 'failed',
      error: {
        name: 'TypeError',
        message: 'fetch failed for ***',
        code: 'ECONNRESET',
      },
    })
    const logged = JSON.stringify((logger.error as jest.Mock).mock.calls)
    expect(logged).not.toContain('THROWNKEY')
    expect(logged).not.toContain('Authorization')
  })

  it('smtp mode: sends the rendered html/text with from/to/subject', async () => {
    process.env.SMTP_HOST = 'mail.internal'
    process.env.SMTP_PORT = '2525'
    process.env.EMAIL_FROM = 'Lumo <lumo@corp.test>'

    const out = await sendEmail({
      to: ['bo@acme.test'],
      subject: invite.subject,
      html: invite.html,
      text: 'plain body',
      replyTo: 'privacy@corp.test',
    })

    expect(out.status).toBe('sent')
    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'mail.internal',
      port: 2525,
      secure: false,
      ...SMTP_TIMEOUTS,
    })
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('smtp mode: the built MIME message carries the exact fields', async () => {
    process.env.SMTP_URL = 'smtp://mail.internal:25'
    const json = realNodemailer.createTransport({ jsonTransport: true })
    const spy = jest.spyOn(json, 'sendMail')
    mockCreateTransport.mockReturnValue(json)

    await sendEmail({
      to: ['bo@acme.test'],
      subject: invite.subject,
      html: invite.html,
      text: 'plain body',
    })

    expect(mockCreateTransport).toHaveBeenCalledWith({
      url: 'smtp://mail.internal:25',
      ...SMTP_TIMEOUTS,
    })
    const info = await spy.mock.results[0]!.value
    const built = JSON.parse(info.message)
    expect(built.from).toEqual({ address: 'noreply@uselumo.ai', name: 'Lumo' })
    expect(built.to).toEqual([{ address: 'bo@acme.test', name: '' }])
    expect(built.subject).toBe(invite.subject)
    expect(built.html).toBe(invite.html)
    expect(built.text).toBe('plain body')
  })

  it('smtp mode: a transport error comes back as failed, not thrown', async () => {
    process.env.SMTP_HOST = 'mail.internal'
    mockCreateTransport.mockReturnValue({
      sendMail: () => Promise.reject(new Error('ECONNREFUSED')),
    })
    await expect(
      sendEmail({ to: ['x@y.test'], subject: 's', html: 'h' })
    ).resolves.toEqual({
      status: 'failed',
      error: { name: 'Error', message: 'ECONNREFUSED' },
    })
    expect(logger.error).toHaveBeenCalled()
  })

  it('smtp mode: failure result + log keep the error code but no credentials', async () => {
    process.env.SMTP_HOST = 'mail.internal'
    process.env.SMTP_USER = 'bob'
    process.env.SMTP_PASS = 'hunter2-secret'
    const err = Object.assign(
      new Error('Invalid login: 535 rejected hunter2-secret'),
      {
        code: 'EAUTH',
        // nodemailer-style extras that must never be logged wholesale
        transportConfig: { auth: { user: 'bob', pass: 'hunter2-secret' } },
      }
    )
    mockCreateTransport.mockReturnValue({
      sendMail: () => Promise.reject(err),
    })

    const out = await sendEmail({ to: ['x@y.test'], subject: 's', html: 'h' })

    expect(out).toEqual({
      status: 'failed',
      error: {
        name: 'Error',
        message: 'Invalid login: 535 rejected ***',
        code: 'EAUTH',
      },
    })
    expect(logger.error).toHaveBeenCalledWith('[email] send failed', {
      transport: 'smtp',
      name: 'Error',
      message: 'Invalid login: 535 rejected ***',
      code: 'EAUTH',
    })
    const logged = JSON.stringify((logger.error as jest.Mock).mock.calls)
    expect(logged).not.toContain('hunter2-secret')
    expect(logged).not.toContain('transportConfig')
  })

  it('unconfigured: logs and no-ops without throwing', async () => {
    await expect(
      sendEmail({ to: ['x@y.test'], subject: 's', html: 'h' })
    ).resolves.toEqual({ status: 'skipped', reason: 'not_configured' })
    await sendEmail({ to: ['x@y.test'], subject: 's2', html: 'h' })
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockCreateTransport).not.toHaveBeenCalled()
  })
})
