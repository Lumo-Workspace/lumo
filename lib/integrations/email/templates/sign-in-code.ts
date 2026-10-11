/**
 * LUM-1082 — the one-time code email of Better Auth's email-code sign-in (and
 * of email verification by code), in the requester's language. The strings
 * live in the react-intl catalogues (`email.signInCode.*`, every locale) and
 * carry no ICU arguments, so they are read straight from MESSAGES; the code
 * itself is appended, never interpolated into a translation.
 */
import { MESSAGES } from '@/lib/i18n/messages'
import type { PublicLocale } from '@/lib/i18n/public-locale'

export interface SignInCodeEmailResult {
  subject: string
  html: string
  text: string
}

const KEYS = {
  subject: 'email.signInCode.subject',
  heading: 'email.signInCode.heading',
  body: 'email.signInCode.body',
  ignore: 'email.signInCode.ignore',
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
    ignore: read(KEYS.ignore),
  }
}

export function buildSignInCodeEmail(
  code: string,
  locale: PublicLocale
): SignInCodeEmailResult {
  const copy = copyFor(locale)
  return {
    subject: copy.subject,
    text: `${copy.body}\n\n${code}\n\n${copy.ignore}`,
    html: `<!DOCTYPE html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"/></head>
<body style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;padding:32px;">
<h1 style="font-size:20px;">${escapeHtml(copy.heading)}</h1>
<p style="font-size:15px;color:#444;">${escapeHtml(copy.body)}</p>
<p style="font-size:32px;font-weight:600;letter-spacing:8px;font-family:ui-monospace,Menlo,Consolas,monospace;">${escapeHtml(code)}</p>
<p style="font-size:12px;color:#999;">${escapeHtml(copy.ignore)}</p>
</body></html>`,
  }
}
