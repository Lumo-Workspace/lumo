import { createHash, createHmac, timingSafeEqual } from 'crypto'

/**
 * Read receipts for the CLI disposition handshake (LUM-769).
 *
 * LUM-812 generalised this from crossings to any dispositionable subject; it
 * lives under `lib/disposition/` rather than `lib/boundary-crossing/` for that
 * reason. The subject is opaque here — `kind` + `subjectId` + a caller-computed
 * `stateHash` — so a second handshake never needs a second implementation of
 * the ordering rules. `kind` is part of the signed message, so a receipt issued
 * for a crossing can never be replayed against a test-case defect.
 *
 * The exit-4 confirmation protocol is a convention: nothing stops an agent
 * from running `--confirm` first. The receipts turn the ordering into a
 * server-enforced, three-step handshake — the way a web form is loaded, the
 * "I have read this" box is ticked, and only then the submit button works:
 *
 *   1. READ    — the envelope step asks the server for a stage-1 receipt: the
 *                server signs (crossing, task, target ruling, caller
 *                session/member, the crossing's CURRENT state, issued/expiry)
 *                and hands back a short token, writing nothing;
 *   2. ACK     — `--confirm-read` presents that token; the server verifies it
 *                and issues a stage-2 receipt that additionally carries the
 *                read time — "the user acknowledged reading this";
 *   3. CONFIRM — `--confirm` must present a STAGE-2 token; a stage-1 token
 *                (read but never acknowledged) is refused with
 *                `not_acknowledged`, and the write records both timestamps on
 *                its audit row.
 *
 * At every step the server recomputes the same message from the request and
 * the crossing as it is NOW, so a write can only follow a read AND an
 * acknowledgement of the same crossing, for the same ruling, by the same
 * caller, and only while the crossing still looks like what was read (a
 * recurrence, a new explanation or a ruling in between changes the state hash
 * and voids every outstanding receipt). What it cannot prove is that the
 * human personally ticked the box — the agent relays each step — which is why
 * the ruling is still stamped `channel: 'CLI'`.
 *
 * Stateless by design: no table, no migration, nothing persisted before the
 * write. Tokens are `r1.<iat>.<exp>.<sig>` and `r2.<readAt>.<iat>.<exp>.<sig>`
 * — every other field lives in the request context, so a mismatch on any of
 * them simply fails the signature.
 */

export const READ_RECEIPT_TTL_MS = 10 * 60 * 1000

/** READ = stage 1 (envelope shown); ACK = stage 2 (read acknowledged). */
export type ReceiptStage = 'READ' | 'ACK'
const STAGE_PREFIX: Record<ReceiptStage, string> = { READ: 'r1', ACK: 'r2' }

/** The stage a token claims, from its prefix — null when it is neither. */
export function receiptStageOf(receipt: string): ReceiptStage | null {
  if (receipt.startsWith('r1.')) return 'READ'
  if (receipt.startsWith('r2.')) return 'ACK'
  return null
}

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

/** Which kind of thing is being ruled on. Part of the signed message. */
export type ReceiptSubjectKind = 'CROSSING' | 'TEST_CASE_DEFECT'

export interface ReceiptSubject {
  kind: ReceiptSubjectKind
  subjectId: string
  taskId: string
  /**
   * The ruling this receipt pre-authorises, as that subject's own enum value
   * (`FALSE_POSITIVE` | `CONFIRMED` for a crossing, `KNOWN_DEFECT` |
   * `NOT_A_DEFECT` for a test-case defect). Opaque here on purpose — widening
   * it is what lets one handshake serve both; each caller still types its own
   * value at its own boundary.
   */
  target: string
  /** Caller session (X-Lumo-Session-Id); null when the CLI ran unbound. */
  sessionId: string | null
  /** Workspace member behind the bearer key. */
  memberId: string
  stateHash: string
}

export interface IssuedReceipt {
  receipt: string
  stage: ReceiptStage
  expiresAt: string
  /** When the envelope was first shown (stage-1 issue time). */
  readAt: string
  /** When reading was acknowledged — set on stage-2 receipts only. */
  readAcknowledgedAt: string | null
}

export type ReceiptFailure = {
  ok: false
  reason: 'malformed' | 'expired' | 'mismatch' | 'not_acknowledged'
}

export type ReceiptVerdict =
  | {
      ok: true
      stage: ReceiptStage
      readAt: string
      readAcknowledgedAt: string | null
    }
  | ReceiptFailure

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

function message(
  stage: ReceiptStage,
  subject: ReceiptSubject,
  readAt: number,
  iat: number,
  exp: number
): string {
  return [
    STAGE_PREFIX[stage],
    subject.kind,
    subject.subjectId,
    subject.taskId,
    subject.target,
    subject.sessionId ?? '',
    subject.memberId,
    subject.stateHash,
    String(readAt),
    String(iat),
    String(exp),
  ].join('|')
}

function sign(secret: string, msg: string): string {
  // The salt keeps its historical value on purpose: changing it would void
  // every receipt in flight at deploy time. Domain separation between subject
  // kinds comes from `subject.kind` inside the signed message, not the salt.
  return createHmac('sha256', `lumo-crossing-read-receipt:${secret}`)
    .update(msg, 'utf8')
    .digest('base64url')
}

function build(
  secret: string,
  stage: ReceiptStage,
  subject: ReceiptSubject,
  readAt: number,
  now: Date,
  ttlMs: number
): IssuedReceipt {
  const iat = now.getTime()
  const exp = iat + ttlMs
  const sig = sign(secret, message(stage, subject, readAt, iat, exp))
  const prefix = STAGE_PREFIX[stage]
  const receipt =
    stage === 'READ'
      ? `${prefix}.${iat}.${exp}.${sig}`
      : `${prefix}.${readAt}.${iat}.${exp}.${sig}`
  return {
    receipt,
    stage,
    expiresAt: new Date(exp).toISOString(),
    readAt: new Date(readAt).toISOString(),
    readAcknowledgedAt: stage === 'ACK' ? new Date(iat).toISOString() : null,
  }
}

/** Stage 1: the envelope was built for this subject. Writes nothing. */
export function issueReadReceipt(
  secret: string,
  subject: ReceiptSubject,
  now: Date = new Date(),
  ttlMs: number = READ_RECEIPT_TTL_MS
): IssuedReceipt {
  return build(secret, 'READ', subject, now.getTime(), now, ttlMs)
}

/**
 * Stage 2: the user acknowledged reading the envelope. Verifies the stage-1
 * receipt for this subject and issues the stage-2 receipt that carries the
 * original read time forward. A stage-2 token presented here is refused as
 * `mismatch` (acknowledging twice is not a thing).
 */
export function acknowledgeReadReceipt(
  secret: string,
  readReceipt: string,
  subject: ReceiptSubject,
  now: Date = new Date(),
  ttlMs: number = READ_RECEIPT_TTL_MS
): { ok: true; issued: IssuedReceipt } | ReceiptFailure {
  const verdict = verifyReadReceipt(secret, readReceipt, subject, now)
  if (!verdict.ok) return verdict
  if (verdict.stage !== 'READ') return { ok: false, reason: 'mismatch' }
  const readAt = new Date(verdict.readAt).getTime()
  return {
    ok: true,
    issued: build(secret, 'ACK', subject, readAt, now, ttlMs),
  }
}

/**
 * Pure verification of either stage. The caller supplies the subject as it
 * stands NOW (path params, body target, headers, identity, fresh state hash);
 * any drift from what was signed reads as `mismatch`. Pass
 * `requireStage: 'ACK'` on the write path — a valid stage-1 token then fails
 * as `not_acknowledged`, so the caller can say exactly which step is missing.
 * Timing-safe on the signature compare.
 */
export function verifyReadReceipt(
  secret: string,
  receipt: string,
  subject: ReceiptSubject,
  now: Date = new Date(),
  options: { requireStage?: ReceiptStage } = {}
): ReceiptVerdict {
  const parts = receipt.split('.')
  const stage = receiptStageOf(receipt)
  if (stage === null) return { ok: false, reason: 'malformed' }
  const expectedLen = stage === 'READ' ? 4 : 5
  if (parts.length !== expectedLen) return { ok: false, reason: 'malformed' }
  const nums = parts.slice(1, -1).map(Number)
  const sig = parts[parts.length - 1] ?? ''
  if (nums.some(n => !Number.isInteger(n)) || sig.length === 0) {
    return { ok: false, reason: 'malformed' }
  }
  const [readAt, iat, exp] =
    stage === 'READ'
      ? [nums[0] as number, nums[0] as number, nums[1] as number]
      : [nums[0] as number, nums[1] as number, nums[2] as number]
  const expected = sign(secret, message(stage, subject, readAt, iat, exp))
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'mismatch' }
  }
  if (now.getTime() > exp) return { ok: false, reason: 'expired' }
  if (options.requireStage && options.requireStage !== stage) {
    return { ok: false, reason: 'not_acknowledged' }
  }
  return {
    ok: true,
    stage,
    readAt: new Date(readAt).toISOString(),
    readAcknowledgedAt: stage === 'ACK' ? new Date(iat).toISOString() : null,
  }
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

/**
 * The 409 a refused receipt turns into.
 *
 * `noun` is what the caller calls the thing being ruled on ('crossing',
 * 'test case run'). The crossing wording is preserved verbatim by its default
 * — LUM-769's tests assert these strings, and generalising the handshake is
 * not a licence to reword them.
 */
export function receiptRefusal(
  failure: ReceiptFailure,
  step: '--confirm-read' | '--confirm',
  noun = 'crossing'
): Error & { status: number } {
  const why =
    failure.reason === 'not_acknowledged'
      ? 'read not yet acknowledged — run the command with --confirm-read (the receipt from the envelope) first; only the receipt that step returns is accepted with --confirm'
      : failure.reason === 'expired'
        ? `the read receipt has expired. Re-run the command without ${step} to read the ${noun} again and get a fresh envelope`
        : failure.reason === 'malformed'
          ? `the read receipt is malformed. Re-run the command without ${step} to get a fresh envelope`
          : `the read receipt does not match this ${noun}, ruling, caller, or the ${noun} has changed since it was read. Re-run the command without ${step} to read the ${noun} again and get a fresh envelope`
  return Object.assign(new Error(`Refused: ${why}.`), { status: 409 })
}
