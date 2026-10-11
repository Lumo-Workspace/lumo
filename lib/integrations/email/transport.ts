/**
 * LUM-1082 — which email transport the env selects. Pure (no nodemailer, no
 * database) so code that only needs to know whether email can go out — the
 * Better Auth public config, which the browser bundle also imports — does
 * not pull in the transport. `./client` re-exports it.
 *
 *   SMTP_URL or SMTP_HOST set   → 'smtp'
 *   else RESEND_API_KEY set     → 'resend_relay' (Resend's SMTP relay)
 *   else                        → 'none' (emails are logged and skipped)
 */
export type EmailTransportKind = 'smtp' | 'resend_relay' | 'none'

type Env = Record<string, string | undefined>

export function resolveEmailTransport(
  env: Env = process.env
): EmailTransportKind {
  if (env.SMTP_URL || env.SMTP_HOST) return 'smtp'
  if (env.RESEND_API_KEY) return 'resend_relay'
  return 'none'
}
