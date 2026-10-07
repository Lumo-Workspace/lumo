import nodemailer from 'nodemailer'
import type { Transporter, TransportOptions } from 'nodemailer'
import { logger } from '@/lib/logger'
import { emailDeliveryRepository } from '@/lib/repositories/email-delivery.repository'

/**
 * LUM-1017 / LUM-1041: the single email transport for the app. Every email
 * goes over SMTP via nodemailer; the env only picks the server.
 *
 *   SMTP_URL or SMTP_HOST set   → that SMTP server (self-hosting, explicit)
 *   else RESEND_API_KEY set     → Resend's SMTP relay (hosted SaaS default:
 *                                 smtp.resend.com:465, user `resend`,
 *                                 password = the key — no env change needed)
 *   else                        → unconfigured: log + no-op, never throws
 *
 * Idempotency is the app's job (SMTP has none): a send with an
 * `idempotencyKey` claims an `email_deliveries` row first and is skipped as
 * a duplicate when the key was already sent or is in flight.
 *
 * Callers use `sendEmail`; they never import a provider SDK.
 */
export type EmailTransportKind = 'smtp' | 'resend_relay' | 'none'

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
  /**
   * At most one send per key, ever (app-level, `email_deliveries`): a key
   * already SENT — or being sent right now — is skipped as `duplicate`; a
   * FAILED key may be retried. Omit it for sends that may repeat.
   */
  idempotencyKey?: string
}

export type SendEmailResult =
  | { status: 'sent'; id: string | null }
  | { status: 'failed'; error: SendEmailError }
  | { status: 'skipped'; reason: 'not_configured' }
  | {
      status: 'skipped'
      reason: 'duplicate'
      /** `sent`: done earlier; `sending`: another request is sending it now. */
      prior: 'sent' | 'sending'
      /** Message id of the earlier send, when known. */
      id: string | null
    }

/** True when the email went out, now or by an earlier/concurrent send. */
export function isEmailDelivered(result: SendEmailResult): boolean {
  return (
    result.status === 'sent' ||
    (result.status === 'skipped' && result.reason === 'duplicate')
  )
}

/**
 * A SENDING claim older than this is treated as a crashed send and may be
 * reclaimed. Far above the worst bounded SMTP send (SMTP_TIMEOUTS, ~50 s).
 */
export const EMAIL_CLAIM_STALE_MS = 10 * 60_000

/** Resend's SMTP relay — https://resend.com/docs/send-with-smtp */
export const RESEND_SMTP_RELAY = {
  host: 'smtp.resend.com',
  /** 465 = implicit TLS (SMTPS); Resend also offers 587/2587/25 STARTTLS. */
  port: 465,
  secure: true,
  user: 'resend',
} as const

export const DEFAULT_EMAIL_FROM = 'Lumo <noreply@uselumo.ai>'

type Env = Record<string, string | undefined>

export function resolveEmailTransport(
  env: Env = process.env
): EmailTransportKind {
  if (env.SMTP_URL || env.SMTP_HOST) return 'smtp'
  if (env.RESEND_API_KEY) return 'resend_relay'
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
 * when both are set); otherwise, with RESEND_API_KEY, Resend's SMTP relay.
 * Every shape carries SMTP_TIMEOUTS.
 */
export function smtpTransportOptions(env: Env = process.env): TransportOptions {
  if (env.SMTP_URL) {
    return { url: env.SMTP_URL, ...SMTP_TIMEOUTS } as TransportOptions
  }
  if (!env.SMTP_HOST && env.RESEND_API_KEY) {
    return {
      host: RESEND_SMTP_RELAY.host,
      port: RESEND_SMTP_RELAY.port,
      secure: RESEND_SMTP_RELAY.secure,
      auth: { user: RESEND_SMTP_RELAY.user, pass: env.RESEND_API_KEY },
      ...SMTP_TIMEOUTS,
    } as TransportOptions
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

let _smtp: Transporter | null = null
let _warnedUnconfigured = false

function getSmtp(): Transporter {
  if (!_smtp) _smtp = nodemailer.createTransport(smtpTransportOptions())
  return _smtp
}

/** Test seam: drop cached transports so env changes take effect. */
export function resetEmailTransportForTests(): void {
  _smtp = null
  _warnedUnconfigured = false
}

export interface SendEmailError {
  name: string
  message: string
  /**
   * Transport error code when there is one: nodemailer's `code` (EAUTH,
   * ECONNECTION, ETIMEDOUT, ESOCKET, EENVELOPE, EMESSAGE, …), or
   * EIDEMPOTENCY when the idempotency ledger could not be reached.
   */
  code?: string
  /** SMTP reply code the server answered with (e.g. 535), when there was one. */
  statusCode?: number
}

/** Secrets that must never reach logs or results, from the email env. */
function emailSecrets(env: Env): string[] {
  const secrets: string[] = []
  if (env.RESEND_API_KEY) secrets.push(env.RESEND_API_KEY)
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

/**
 * Replace any email secret (RESEND_API_KEY, SMTP_PASS, SMTP_URL password)
 * and any URL userinfo in `text` with `***`.
 */
export function redactEmailSecrets(
  text: string,
  env: Env = process.env
): string {
  let out = text.replace(/(smtps?:\/\/)[^@\s/]*@/gi, '$1***@')
  for (const secret of emailSecrets(env)) out = out.split(secret).join('***')
  return out
}

/**
 * The one shape a send failure leaves this module in: name / message
 * (secrets redacted) / code / statusCode — never the error object itself,
 * whose nodemailer variants can carry the transport config.
 *
 * `code`: the error's own string `code` (nodemailer: EAUTH, ETIMEDOUT, …);
 * for a plain non-Error `{ name, … }` value, its `name`.
 * `statusCode`: nodemailer's SMTP `responseCode` (535, 550, …), or a numeric
 * `statusCode` the value carries.
 */
export function toEmailError(
  e: unknown,
  env: Env = process.env
): SendEmailError {
  const obj =
    typeof e === 'object' && e !== null
      ? (e as {
          name?: unknown
          message?: unknown
          code?: unknown
          statusCode?: unknown
          responseCode?: unknown
        })
      : null
  const name = typeof obj?.name === 'string' && obj.name ? obj.name : 'Error'
  const message =
    typeof obj?.message === 'string' ? obj.message : obj ? '' : String(e)
  const nameIsCode = !(e instanceof Error)
  const code =
    typeof obj?.code === 'string' && obj.code
      ? obj.code
      : obj && nameIsCode && typeof obj.name === 'string' && obj.name
        ? obj.name
        : undefined
  const statusCode =
    typeof obj?.responseCode === 'number'
      ? obj.responseCode
      : typeof obj?.statusCode === 'number'
        ? obj.statusCode
        : undefined
  return {
    name: redactEmailSecrets(name, env),
    message: redactEmailSecrets(message, env),
    ...(code ? { code: redactEmailSecrets(code, env) } : {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
  }
}

function sendFailed(
  transport: EmailTransportKind,
  e: unknown
): { status: 'failed'; error: SendEmailError } {
  const error = toEmailError(e, process.env)
  logger.error('[email] send failed', { transport, ...error })
  return { status: 'failed', error }
}

/** One SMTP send; never throws. */
async function deliver(
  kind: Exclude<EmailTransportKind, 'none'>,
  message: EmailMessage,
  idempotencyKey: string | undefined
): Promise<SendEmailResult> {
  try {
    const info = await getSmtp().sendMail({
      from: message.from ?? resolveEmailFrom(),
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      // Resend dedupes on this header too (24 h): covers a crash between
      // the send and recording it SENT. Other servers never see it.
      ...(kind === 'resend_relay' && idempotencyKey
        ? { headers: { 'Resend-Idempotency-Key': idempotencyKey } }
        : {}),
    })
    return { status: 'sent', id: info.messageId ?? null }
  } catch (e) {
    return sendFailed(kind, e)
  }
}

export async function sendEmail(
  message: EmailMessage,
  options: SendEmailOptions = {}
): Promise<SendEmailResult> {
  const kind = resolveEmailTransport()

  if (kind === 'none') {
    if (!_warnedUnconfigured) {
      _warnedUnconfigured = true
      logger.warn(
        '[email] no transport configured (set SMTP_URL/SMTP_HOST or RESEND_API_KEY); emails are skipped'
      )
    }
    logger.info('[email] skipped (not configured)', {
      subject: message.subject,
    })
    return { status: 'skipped', reason: 'not_configured' }
  }

  const key = options.idempotencyKey
  if (!key) return deliver(kind, message, undefined)

  let claim
  try {
    claim = await emailDeliveryRepository.claim(
      key,
      new Date(Date.now() - EMAIL_CLAIM_STALE_MS)
    )
  } catch (e) {
    // Fail closed: without the ledger a send could repeat (compliance
    // notices must not), so report a failure the caller may retry.
    logger.error('[email] idempotency claim failed; not sending', {
      transport: kind,
      name: e instanceof Error ? e.name : 'Error',
      message: e instanceof Error ? redactEmailSecrets(e.message) : '',
    })
    return {
      status: 'failed',
      error: {
        name: 'EmailIdempotencyError',
        message: 'idempotency ledger unavailable',
        code: 'EIDEMPOTENCY',
      },
    }
  }

  if (!claim.claimed) {
    const prior = claim.status === 'SENT' ? 'sent' : 'sending'
    logger.info('[email] skipped (duplicate idempotency key)', {
      prior,
      subject: message.subject,
    })
    return {
      status: 'skipped',
      reason: 'duplicate',
      prior,
      id: claim.messageId,
    }
  }

  const result = await deliver(kind, message, key)
  try {
    if (result.status === 'sent') {
      await emailDeliveryRepository.markSent(key, result.id)
    } else if (result.status === 'failed') {
      await emailDeliveryRepository.markFailed(
        key,
        claim.attempt,
        result.error.code ?? null
      )
    }
  } catch (e) {
    // The send outcome stands; a SENDING row left behind is reclaimable after
    // EMAIL_CLAIM_STALE_MS (and Resend's own header dedupes a relay resend).
    logger.error('[email] could not record delivery outcome', {
      outcome: result.status,
      name: e instanceof Error ? e.name : 'Error',
    })
  }
  return result
}
