import { createHash, createHmac, timingSafeEqual } from 'crypto'

/**
 * Read receipt for the CLI disposition handshake (LUM-769).
 *
 * The exit-4 confirmation protocol is a convention: nothing stops an agent
 * from running `--confirm` first. The receipt turns the ordering into a
 * server-enforced handshake, the way a web form is loaded before it is
 * submitted:
 *
 *   1. the envelope step asks the server for a receipt — the server signs
 *      (crossing, task, target ruling, caller session/member, current crossing
 *      STATE, issued/expiry) and hands back a short token, writing nothing;
 *   2. the `--confirm` step must carry that token; the server recomputes the
 *      same message from the request + the crossing as it is NOW and checks
 *      the signature.
 *
 * So a write can only follow a read of the same crossing, for the same ruling,
 * by the same caller, and only while the crossing still looks like what was
 * read (a recurrence, a new explanation or a ruling in between changes the
 * state hash and voids the receipt). What it cannot prove is that the human
 * actually looked at the relayed envelope — that stays a protocol rule, which
 * is why the ruling is still stamped `channel: 'CLI'`.
 *
 * Stateless by design: no table, no migration, nothing persisted on the read
 * step. The token is `r1.<iat>.<exp>.<sig>` — every other field lives in the
 * request context, so a mismatch on any of them simply fails the signature.
 */

export const READ_RECEIPT_TTL_MS = 10 * 60 * 1000
const VERSION = 'r1'

/** The crossing fields whose change must void an outstanding receipt. */
export interface ReceiptCrossingState {
  disposition: string | null
  occurrenceCount: number
  lastSeenAt: Date | string | null
  detectedAt: Date | string
  severity: string
  category: string
  detail: string
  /** Ids of the explanations on record, oldest-first. */
  explanationIds: string[]
}

export interface ReceiptSubject {
  crossingId: string
  taskId: string
  target: 'FALSE_POSITIVE' | 'CONFIRMED'
  /** Caller session (X-Lumo-Session-Id); null when the CLI ran unbound. */
  sessionId: string | null
  /** Workspace member behind the bearer key. */
  memberId: string
  stateHash: string
}

export interface IssuedReceipt {
  receipt: string
  expiresAt: string
}

export type ReceiptVerdict =
  | { ok: true }
  | {
      ok: false
      reason: 'malformed' | 'expired' | 'mismatch'
    }

const iso = (v: Date | string | null): string =>
  v == null ? '' : v instanceof Date ? v.toISOString() : String(v)

/** Deterministic digest of the crossing state a receipt is issued against. */
export function crossingStateHash(state: ReceiptCrossingState): string {
  const canonical = JSON.stringify([
    state.disposition ?? null,
    state.occurrenceCount,
    iso(state.lastSeenAt),
    iso(state.detectedAt),
    state.severity,
    state.category,
    state.detail,
    state.explanationIds,
  ])
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function message(subject: ReceiptSubject, iat: number, exp: number): string {
  return [
    VERSION,
    subject.crossingId,
    subject.taskId,
    subject.target,
    subject.sessionId ?? '',
    subject.memberId,
    subject.stateHash,
    String(iat),
    String(exp),
  ].join('|')
}

function sign(secret: string, msg: string): string {
  return createHmac('sha256', `lumo-crossing-read-receipt:${secret}`)
    .update(msg, 'utf8')
    .digest('base64url')
}

export function issueReadReceipt(
  secret: string,
  subject: ReceiptSubject,
  now: Date = new Date(),
  ttlMs: number = READ_RECEIPT_TTL_MS
): IssuedReceipt {
  const iat = now.getTime()
  const exp = iat + ttlMs
  const sig = sign(secret, message(subject, iat, exp))
  return {
    receipt: `${VERSION}.${iat}.${exp}.${sig}`,
    expiresAt: new Date(exp).toISOString(),
  }
}

/**
 * Pure verification. The caller supplies the subject as it stands NOW (path
 * params, body target, headers, identity, fresh state hash); any drift from
 * what was signed reads as `mismatch`. Timing-safe on the signature compare.
 */
export function verifyReadReceipt(
  secret: string,
  receipt: string,
  subject: ReceiptSubject,
  now: Date = new Date()
): ReceiptVerdict {
  const parts = receipt.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    return { ok: false, reason: 'malformed' }
  }
  const iat = Number(parts[1])
  const exp = Number(parts[2])
  const sig = parts[3] ?? ''
  if (!Number.isInteger(iat) || !Number.isInteger(exp) || sig.length === 0) {
    return { ok: false, reason: 'malformed' }
  }
  const expected = sign(secret, message(subject, iat, exp))
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'mismatch' }
  }
  if (now.getTime() > exp) return { ok: false, reason: 'expired' }
  return { ok: true }
}

/**
 * The signing secret. A dedicated `LUMO_RECEIPT_SECRET` wins; otherwise the
 * deployment's `CRON_SECRET` is reused under a domain-separating prefix (it is
 * already mandatory for every cron/internal route). Null = not configured —
 * callers fail closed (no receipt can be issued, so no CLI ruling can be
 * written) rather than falling back to an unsigned or hardcoded key.
 */
export function readReceiptSecret(
  env: Record<string, string | undefined> = process.env
): string | null {
  const s = env.LUMO_RECEIPT_SECRET || env.CRON_SECRET
  return s && s.length > 0 ? s : null
}
