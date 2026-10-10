/**
 * LUM-1070 — forgot / reset password for Better Auth accounts.
 *
 * Flow: /reset-password (no token) asks for an email → POST
 * /api/auth/request-password-reset with `redirectTo: RESET_PASSWORD_PATH`
 * (./sign-in-helpers) →
 * Better Auth stores a one-hour token and calls `sendResetPasswordEmail` →
 * the link (GET /api/auth/reset-password/<token>) lands back on
 * /reset-password?token=… (or ?error=INVALID_TOKEN) → the new password is
 * POSTed to /api/auth/reset-password. Better Auth answers the request step
 * identically whether or not the address has an account.
 *
 * The email goes through Lumo's mail layer (SMTP or the Resend relay,
 * LUM-1041) in the language of the browser that asked for it.
 */
import { sendEmail } from '@/lib/integrations/email/client'
import { buildResetPasswordEmail } from '@/lib/integrations/email/templates/reset-password'
import { resolvePublicLocale } from '@/lib/i18n/public-locale'
import { logger } from '@/lib/logger'

/** Reset links expire after this many seconds (Better Auth's default). */
export const RESET_PASSWORD_TOKEN_TTL_SECONDS = 60 * 60

/** `emailAndPassword.sendResetPassword`. */
export async function sendResetPasswordEmail(
  { user, url }: { user: { email: string }; url: string },
  request?: Request
): Promise<void> {
  const locale = resolvePublicLocale({
    acceptLanguage: request?.headers.get('accept-language'),
  })
  const { subject, html, text } = buildResetPasswordEmail(url, locale)
  const result = await sendEmail({ to: [user.email], subject, html, text })
  if (result.status !== 'sent') {
    logger.warn('[auth] password reset email not sent', {
      status: result.status,
    })
  }
}
