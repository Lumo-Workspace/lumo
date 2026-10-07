import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import type { Transporter, TransportOptions } from 'nodemailer'
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
  | { status: 'failed'; error: SendEmailError }
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
 * Bounded SMTP waits so an unreachable or stalled server fails the send in
 * seconds instead of hanging the request (nodemailer defaults: 2 min connect,
 * 30 s greeting, 10 min socket inactivity).
 */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const

const DEFAULT_SMTP_PORT = 587

function parseSmtpPort(raw: string | undefined): number {
  if (!raw) return DEFAULT_SMTP_PORT
  const port = Number(raw)
  if (Number.isInteger(port) && port >= 1 && port <= 65535) return port
  logger.warn(
    '[email] SMTP_PORT is not a valid port (1-65535); using default',
    {
      smtpPort: raw,
      defaultPort: DEFAULT_SMTP_PORT,
    }
  )
  return DEFAULT_SMTP_PORT
}

/** `true` / `TRUE` / `1` / `yes` → true; anything else set → false. */
function parseSmtpSecure(raw: string | undefined, port: number): boolean {
  if (raw === undefined || raw.trim() === '') return port === 465
  return ['true', '1', 'yes'].includes(raw.trim().toLowerCase())
}

function smtpAuth(env: Env): { user: string; pass: string } | undefined {
  const { SMTP_USER: user, SMTP_PASS: pass } = env
  if (user && pass) return { user, pass }
  if (user || pass) {
    logger.warn(
      '[email] only one of SMTP_USER / SMTP_PASS is set; connecting without auth',
      { hasUser: Boolean(user), hasPass: Boolean(pass) }
    )
  }
  return undefined
}

/**
 * SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465) wins; otherwise
 * SMTP_HOST + SMTP_PORT (1-65535, default 587) + SMTP_SECURE (true/1/yes,
 * case-insensitive; default: port 465) and SMTP_USER + SMTP_PASS (auth only
 * when both are set). Both shapes carry SMTP_TIMEOUTS.
 */
export function smtpTransportOptions(env: Env = process.env): TransportOptions {
  if (env.SMTP_URL) {
    return { url: env.SMTP_URL, ...SMTP_TIMEOUTS } as TransportOptions
  }
  const port = parseSmtpPort(env.SMTP_PORT)
  const auth = smtpAuth(env)
  return {
    host: env.SMTP_HOST,
    port,
    secure: parseSmtpSecure(env.SMTP_SECURE, port),
    ...(auth ? { auth } : {}),
    ...SMTP_TIMEOUTS,
  } as TransportOptions
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

export interface SendEmailError {
  name: string
  message: string
  /** Provider/transport error code when there is one (e.g. ETIMEDOUT, EAUTH). */
  code?: string
}

/** Secrets that must never reach logs or results, from the SMTP env. */
function smtpSecrets(env: Env): string[] {
  const secrets: string[] = []
  if (env.SMTP_PASS) secrets.push(env.SMTP_PASS)
  if (env.SMTP_URL) {
    try {
      const url = new URL(env.SMTP_URL)
      if (url.password) {
        secrets.push(url.password, decodeURIComponent(url.password))
      }
    } catch {
      // unparsable SMTP_URL: nothing to extract
    }
  }
  return secrets.filter(s => s.length > 0)
}

/** Replace any SMTP secret and URL userinfo in `text` with `***`. */
export function redactEmailSecrets(
  text: string,
  env: Env = process.env
): string {
  let out = text.replace(/(smtps?:\/\/)[^@\s/]*@/gi, '$1***@')
  for (const secret of smtpSecrets(env)) out = out.split(secret).join('***')
  return out
}

/**
 * Only name / message / code leave this module — never the error object
 * itself, whose nodemailer variants can carry the transport config.
 */
function toError(e: unknown): SendEmailError {
  const raw =
    e instanceof Error
      ? { name: e.name, message: e.message }
      : { name: 'Error', message: String(e) }
  const code = (e as { code?: unknown } | null)?.code
  return {
    name: raw.name,
    message: redactEmailSecrets(raw.message),
    ...(typeof code === 'string' ? { code } : {}),
  }
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
