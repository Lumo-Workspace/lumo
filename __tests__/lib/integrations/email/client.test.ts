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
  resetEmailTransportForTests,
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
  it('passes SMTP_URL through as-is', () => {
    expect(smtpTransportOptions({ SMTP_URL: 'smtps://u:p@mail:465' })).toBe(
      'smtps://u:p@mail:465'
    )
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
    })
  })
  it('defaults to 587 without TLS-on-connect and no auth', () => {
    expect(smtpTransportOptions({ SMTP_HOST: 'mail' })).toEqual({
      host: 'mail',
      port: 587,
      secure: false,
    })
  })
  it('falls back to 587 when SMTP_PORT is not a valid port', () => {
    expect(
      smtpTransportOptions({ SMTP_HOST: 'mail', SMTP_PORT: 'abc' })
    ).toMatchObject({ port: 587, secure: false })
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

  it('resend mode: an API error comes back as failed, not thrown', async () => {
    process.env.RESEND_API_KEY = 're_test'
    mockResendSend.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'bad to' },
    })
    await expect(
      sendEmail({ to: ['x'], subject: 's', html: 'h' })
    ).resolves.toEqual({
      status: 'failed',
      error: { name: 'validation_error', message: 'bad to' },
    })
    expect(logger.error).toHaveBeenCalled()
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

    expect(mockCreateTransport).toHaveBeenCalledWith('smtp://mail.internal:25')
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
