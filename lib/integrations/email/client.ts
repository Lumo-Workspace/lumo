import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { logger } from '@/lib/logger'

/**
 * LUM-1017: the single email transport for the app, pluggable by env.
 *
 *   RESEND_API_KEY set           → Resend (hosted SaaS default)
 *   else SMTP_URL or SMTP_HOST   → SMTP via nodemailer (self-hosting)
 *   else                         → unconfigured: log + no-op, never throws
 *
 * Callers use `sendEmail`; they never import a provider SDK.
 */
export type EmailTransportKind = 'resend' | 'smtp' | 'none'

export interface EmailMessage {
  to: string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
  /** Defaults to EMAIL_FROM, then DEFAULT_EMAIL_FROM. */
  from?: string
}

export interface SendEmailOptions {
  /** Honoured by Resend; SMTP has no equivalent and ignores it. */
  idempotencyKey?: string
}

export type SendEmailResult =
  | { status: 'sent'; id: string | null }
  | { status: 'failed'; error: { name: string; message: string } }
  | { status: 'skipped'; reason: 'not_configured' }

export const DEFAULT_EMAIL_FROM = 'Lumo <noreply@uselumo.ai>'

type Env = Record<string, string | undefined>

export function resolveEmailTransport(
  env: Env = process.env
): EmailTransportKind {
  if (env.RESEND_API_KEY) return 'resend'
  if (env.SMTP_URL || env.SMTP_HOST) return 'smtp'
  return 'none'
}

export function resolveEmailFrom(env: Env = process.env): string {
  return env.EMAIL_FROM || DEFAULT_EMAIL_FROM
}

/**
 * SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465) wins; otherwise
 * SMTP_HOST + SMTP_PORT (default 587) + SMTP_SECURE (default: port 465) and
 * optional SMTP_USER / SMTP_PASS.
 */
export function smtpTransportOptions(
  env: Env = process.env
): string | nodemailer.TransportOptions {
  if (env.SMTP_URL) return env.SMTP_URL
  const parsedPort = Number(env.SMTP_PORT)
  const port =
    env.SMTP_PORT && Number.isInteger(parsedPort) && parsedPort > 0
      ? parsedPort
      : 587
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465
  const auth =
    env.SMTP_USER || env.SMTP_PASS
      ? { user: env.SMTP_USER ?? '', pass: env.SMTP_PASS ?? '' }
      : undefined
  return {
    host: env.SMTP_HOST,
    port,
    secure,
    ...(auth ? { auth } : {}),
  } as nodemailer.TransportOptions
}

let _resend: Resend | null = null
let _smtp: Transporter | null = null
let _warnedUnconfigured = false

function getResend(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not set')
    }
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}

function getSmtp(): Transporter {
  if (!_smtp) _smtp = nodemailer.createTransport(smtpTransportOptions())
  return _smtp
}

/** Test seam: drop cached transports so env changes take effect. */
export function resetEmailTransportForTests(): void {
  _resend = null
  _smtp = null
  _warnedUnconfigured = false
}

function toError(e: unknown): { name: string; message: string } {
  return e instanceof Error
    ? { name: e.name, message: e.message }
    : { name: 'Error', message: String(e) }
}

export async function sendEmail(
  message: EmailMessage,
  options: SendEmailOptions = {}
): Promise<SendEmailResult> {
  const kind = resolveEmailTransport()
  const from = message.from ?? resolveEmailFrom()

  if (kind === 'none') {
    if (!_warnedUnconfigured) {
      _warnedUnconfigured = true
      logger.warn(
        '[email] no transport configured (set RESEND_API_KEY or SMTP_URL/SMTP_HOST); emails are skipped'
      )
    }
    logger.info('[email] skipped (not configured)', {
      subject: message.subject,
    })
    return { status: 'skipped', reason: 'not_configured' }
  }

  try {
    if (kind === 'resend') {
      const { data, error } = await getResend().emails.send(
        {
          from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          ...(message.text ? { text: message.text } : {}),
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        },
        options.idempotencyKey
          ? { idempotencyKey: options.idempotencyKey }
          : undefined
      )
      if (error) {
        logger.error('[email] send failed', {
          transport: kind,
          name: error.name,
          message: error.message,
        })
        return {
          status: 'failed',
          error: { name: error.name, message: error.message },
        }
      }
      return { status: 'sent', id: data?.id ?? null }
    }

    const info = await getSmtp().sendMail({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    })
    return { status: 'sent', id: info.messageId ?? null }
  } catch (e) {
    const error = toError(e)
    logger.error('[email] send failed', { transport: kind, ...error })
    return { status: 'failed', error }
  }
}
