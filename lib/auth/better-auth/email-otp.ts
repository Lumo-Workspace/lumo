/**
 * LUM-1082 — email-first, one-time-code sign-in (Better Auth's built-in
 * `emailOTP` plugin, better-auth 1.7.7), the way the Clerk sign-in page
 * works: enter your email → we send a 6-digit code → enter it.
 *
 *   POST /api/auth/email-otp/send-verification-otp { email, type: 'sign-in' }
 *   POST /api/auth/sign-in/email-otp               { email, otp }
 *
 * - An existing account (e.g. one imported from Clerk, which has no password)
 *   signs in to that same account — Better Auth matches it by email.
 * - An unknown email creates the account in the same step unless sign-up is
 *   off (AUTH_DISABLE_SIGNUP); then no code is sent and any code is "wrong",
 *   so the answer never reveals whether an account exists.
 * - The send answers the same either way: the email itself goes out after
 *   the response (`advanced.backgroundTasks` → waitUntil, as in LUM-1070).
 * - Codes are stored hashed, live 10 minutes, and allow 3 wrong tries.
 *   Requests are rate limited by the plugin's rules (3 / 60 s per IP on the
 *   send and sign-in paths), counted in the shared database store (./rate-limit).
 *
 * Only the sign-in and email-verification flows are used. The plugin's
 * password-reset-by-code endpoints are disabled (the link flow of
 * ./password-reset stays the one way to reset a password), and so is
 * change-email.
 */
import type { EmailOTPOptions } from 'better-auth/plugins/email-otp'
import { sendEmail } from '@/lib/integrations/email/client'
import { buildSignInCodeEmail } from '@/lib/integrations/email/templates/sign-in-code'
import { resolvePublicLocale } from '@/lib/i18n/public-locale'
import { logger } from '@/lib/logger'
import { EMAIL_CODE_LENGTH } from './sign-in-helpers'

type SendOtpData = Parameters<EmailOTPOptions['sendVerificationOTP']>[0]
type SendOtpContext = Parameters<EmailOTPOptions['sendVerificationOTP']>[1]

/** Codes expire after this many seconds (Clerk's codes live 10 minutes). */
export const EMAIL_OTP_TTL_SECONDS = 10 * 60
export const EMAIL_OTP_ALLOWED_ATTEMPTS = 3

/** The code types Lumo delivers; the plugin's others are never emailed. */
const DELIVERED_TYPES: ReadonlySet<SendOtpData['type']> = new Set([
  'sign-in',
  'email-verification',
])

/**
 * Plugin endpoints Lumo does not use (`disabledPaths`): resetting a password
 * or changing the email by code. Disabled outright so a code can never set a
 * password — in particular not when password sign-in is off.
 */
export const EMAIL_OTP_DISABLED_PATHS = [
  '/email-otp/request-password-reset',
  '/email-otp/reset-password',
  '/forget-password/email-otp',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
] as const

type Env = Record<string, string | undefined>

/** `sendVerificationOTP`: email the code in the requester's language. */
export async function sendSignInCodeEmail(
  { email, otp, type }: SendOtpData,
  ctx?: SendOtpContext,
  env: Env = process.env
): Promise<void> {
  if (!DELIVERED_TYPES.has(type)) return
  const locale = resolvePublicLocale({
    acceptLanguage: ctx?.request?.headers.get('accept-language'),
  })
  const { subject, html, text } = buildSignInCodeEmail(otp, locale)
  const result = await sendEmail({ to: [email], subject, html, text })
  if (result.status === 'sent') return
  if (result.status === 'skipped' && result.reason === 'not_configured') {
    // Development without SMTP: the log is the mailbox. Never in production
    // (there the code sign-in is not offered without a transport).
    if (env.NODE_ENV !== 'production') {
      logger.info('[auth] email code (dev, email not configured)', {
        type,
        code: otp,
      })
    }
    return
  }
  logger.warn('[auth] email code not sent', { status: result.status })
}

/** The `emailOTP(...)` options of the Lumo instance. */
export function emailOtpOptions(opts: {
  disableSignUp: boolean
}): EmailOTPOptions {
  return {
    sendVerificationOTP: (data, ctx) => sendSignInCodeEmail(data, ctx),
    otpLength: EMAIL_CODE_LENGTH,
    expiresIn: EMAIL_OTP_TTL_SECONDS,
    allowedAttempts: EMAIL_OTP_ALLOWED_ATTEMPTS,
    storeOTP: 'hashed',
    disableSignUp: opts.disableSignUp,
  }
}
