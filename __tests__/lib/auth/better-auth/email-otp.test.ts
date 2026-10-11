/**
 * @jest-environment node
 *
 * LUM-1082 — the email-code sender and options of ./email-otp, and the code
 * email template, without a Better Auth instance (see
 * email-otp.server.test.ts for the HTTP flow).
 */
const mockSendEmail = jest.fn()
jest.mock('@/lib/integrations/email/client', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}))
const mockLogger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
jest.mock('@/lib/logger', () => ({
  get logger() {
    return mockLogger
  },
}))

import {
  EMAIL_OTP_ALLOWED_ATTEMPTS,
  EMAIL_OTP_DISABLED_PATHS,
  EMAIL_OTP_TTL_SECONDS,
  emailOtpOptions,
  sendSignInCodeEmail,
} from '@/lib/auth/better-auth/email-otp'
import { buildSignInCodeEmail } from '@/lib/integrations/email/templates/sign-in-code'
import { MESSAGES } from '@/lib/i18n/messages'
import { PUBLIC_LOCALES } from '@/lib/i18n/public-locale'

const ctxWithLanguage = (lang: string) =>
  ({
    request: new Request('http://x', {
      headers: { 'accept-language': lang },
    }),
  }) as unknown as Parameters<typeof sendSignInCodeEmail>[1]

beforeEach(() => {
  mockSendEmail.mockReset()
  mockSendEmail.mockResolvedValue({ status: 'sent', id: 'm' })
  jest.clearAllMocks()
})

describe('sendSignInCodeEmail (LUM-1082)', () => {
  it('emails the code in the requester language', async () => {
    mockSendEmail.mockResolvedValue({ status: 'sent', id: 'm' })
    await sendSignInCodeEmail(
      { email: 'a@x.io', otp: '123456', type: 'sign-in' },
      ctxWithLanguage('ja')
    )
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const msg = mockSendEmail.mock.calls[0]![0]
    expect(msg.to).toEqual(['a@x.io'])
    expect(msg.subject).toBe(MESSAGES.ja!['email.signInCode.subject'])
    expect(msg.text).toContain('123456')
    expect(msg.html).toContain('123456')
  })

  it('also delivers email-verification codes; never password-reset or change-email ones', async () => {
    mockSendEmail.mockResolvedValue({ status: 'sent', id: 'm' })
    await sendSignInCodeEmail({
      email: 'a@x.io',
      otp: '1',
      type: 'email-verification',
    })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    for (const type of ['forget-password', 'change-email'] as const) {
      await sendSignInCodeEmail({ email: 'a@x.io', otp: '1', type })
    }
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('development without email: the code goes to the log', async () => {
    mockSendEmail.mockResolvedValue({
      status: 'skipped',
      reason: 'not_configured',
    })
    await sendSignInCodeEmail(
      { email: 'a@x.io', otp: '654321', type: 'sign-in' },
      undefined,
      { NODE_ENV: 'development' }
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('email code'),
      { type: 'sign-in', code: '654321' }
    )
  })

  it.each(['production', 'test', undefined])(
    'NODE_ENV=%s never logs the code; the skipped send is a warning',
    async nodeEnv => {
      mockSendEmail.mockResolvedValue({
        status: 'skipped',
        reason: 'not_configured',
      })
      await sendSignInCodeEmail(
        { email: 'a@x.io', otp: '654321', type: 'sign-in' },
        undefined,
        nodeEnv ? { NODE_ENV: nodeEnv } : {}
      )
      expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain('654321')
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[auth] email code not sent',
        { status: 'skipped', reason: 'not_configured' }
      )
      expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain('654321')
    }
  )

  it('a failed send is a warning without the code', async () => {
    mockSendEmail.mockResolvedValue({
      status: 'failed',
      error: { name: 'E', message: 'down' },
    })
    await sendSignInCodeEmail({
      email: 'a@x.io',
      otp: '777777',
      type: 'sign-in',
    })
    expect(mockLogger.warn).toHaveBeenCalledWith('[auth] email code not sent', {
      status: 'failed',
    })
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain('777777')
  })
})

describe('emailOtpOptions (LUM-1082)', () => {
  it('6 digits, hashed, 10 minutes, 3 tries; sign-up follows AUTH_DISABLE_SIGNUP', () => {
    const opts = emailOtpOptions({ disableSignUp: true })
    expect(opts).toMatchObject({
      otpLength: 6,
      expiresIn: EMAIL_OTP_TTL_SECONDS,
      allowedAttempts: EMAIL_OTP_ALLOWED_ATTEMPTS,
      storeOTP: 'hashed',
      disableSignUp: true,
    })
    expect(EMAIL_OTP_TTL_SECONDS).toBe(600)
    expect(emailOtpOptions({ disableSignUp: false }).disableSignUp).toBe(false)
  })

  it('disables every password-by-code and change-email endpoint', () => {
    expect([...EMAIL_OTP_DISABLED_PATHS].sort()).toEqual(
      [
        '/email-otp/change-email',
        '/email-otp/request-email-change',
        '/email-otp/request-password-reset',
        '/email-otp/reset-password',
        '/forget-password/email-otp',
      ].sort()
    )
  })
})

describe('buildSignInCodeEmail (LUM-1082)', () => {
  it('every public locale has its own copy (no English fallback, no TODO)', () => {
    const en = buildSignInCodeEmail('000000', 'en')
    for (const locale of PUBLIC_LOCALES) {
      const email = buildSignInCodeEmail('424242', locale)
      expect(email.subject).not.toMatch(/TODO|email\.signInCode/)
      expect(email.text).toContain('424242')
      expect(email.html).toContain(`lang="${locale}"`)
      if (!locale.startsWith('en')) expect(email.subject).not.toBe(en.subject)
    }
  })

  it('escapes the code in HTML', () => {
    expect(buildSignInCodeEmail('<b>', 'en').html).toContain('&lt;b&gt;')
  })
})
