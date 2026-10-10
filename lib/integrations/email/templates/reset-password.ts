/**
 * LUM-1070 — "reset your password" message for Better Auth accounts, in the
 * requester's language. The strings live in the react-intl catalogues
 * (`email.resetPassword.*`, every locale); they carry no ICU arguments, so
 * they are read straight from the server-safe MESSAGES map.
 */
import { MESSAGES } from '@/lib/i18n/messages'
import type { PublicLocale } from '@/lib/i18n/public-locale'

export interface ResetPasswordEmailResult {
  subject: string
  html: string
  text: string
}

const KEYS = {
  subject: 'email.resetPassword.subject',
  heading: 'email.resetPassword.heading',
  body: 'email.resetPassword.body',
  button: 'email.resetPassword.button',
  ignore: 'email.resetPassword.ignore',
} as const

type Copy = Record<keyof typeof KEYS, string>

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function copyFor(locale: PublicLocale): Copy {
  const messages = MESSAGES[locale] ?? MESSAGES.en ?? {}
  const english = MESSAGES.en ?? {}
  const read = (id: string) => messages[id] ?? english[id] ?? id
  return {
    subject: read(KEYS.subject),
    heading: read(KEYS.heading),
    body: read(KEYS.body),
    button: read(KEYS.button),
    ignore: read(KEYS.ignore),
  }
}

export function buildResetPasswordEmail(
  resetUrl: string,
  locale: PublicLocale
): ResetPasswordEmailResult {
  const copy = copyFor(locale)
  const href = escapeHtml(resetUrl)
  return {
    subject: copy.subject,
    text: `${copy.body}\n\n${resetUrl}\n\n${copy.ignore}`,
    html: `<!DOCTYPE html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"/></head>
<body style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;padding:32px;">
<h1 style="font-size:20px;">${escapeHtml(copy.heading)}</h1>
<p style="font-size:15px;color:#444;">${escapeHtml(copy.body)}</p>
<p><a href="${href}" style="display:inline-block;background:#111;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;">${escapeHtml(copy.button)}</a></p>
<p style="font-size:12px;color:#999;">${escapeHtml(copy.ignore)}</p>
</body></html>`,
  }
}
