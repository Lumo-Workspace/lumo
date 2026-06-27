/**
 * Verification-friction trust axis (LUM-606). Pure: no I/O. Replaces the
 * saturating sample-size axis (deriveConfidence, which landed 214/214 deliveries
 * in `high`) in the LUM-603 terminal join.
 *
 * Friction is read from the append-only, post-delivery-immutable VerificationRun
 * log, CUT at the delivery snapshot's `capturedAt`, and frozen as TWO raw scalars
 * — never a merged "friction" score, never a welded good/bad direction. The
 * derived bucket layer uses value-neutral names; whether friction reads as
 * fragility or scrutiny is decided by the terminal correlation, never presupposed.
 */

/** Bucket names are pure descriptions of the verification record — no degree
 *  ordering, no good/bad implication (spec rule ③ welded all the way to naming). */
export type FrictionBucket =
  | 'no-verification'
  | 'single-round'
  | 'multi-round-or-sendback'

/** Render order is presentation only; it encodes NO good/bad ranking. */
export const FRICTION_BUCKETS: readonly FrictionBucket[] = [
  'no-verification',
  'single-round',
  'multi-round-or-sendback',
] as const

/** One append-only verification run, the only shape the friction core needs.
 *  `verdict` mirrors the Prisma VerificationVerdict enum; only an explicit FAIL
 *  is a send-back (PASS_WITH_FOLLOWUP is not). */
export interface VerificationRunRow {
  round: number
  verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
  createdAt: Date
}

/**
 * Raw friction at delivery: rows with `createdAt <= capturedAt` only (the cut is
 * frozen at delivery, never lifetime). The two scalars are returned SEPARATELY
 * and never merged — they are semantically distinct (repeated rounds = polishing;
 * a FAIL verdict = an explicit send-back) and C3 immutability would make a merged
 * scalar unsplittable later. `null` (not 0) when there is no verification record
 * by capture, so the no-verification case stays distinguishable from zero
 * friction (absence is not a clean pass).
 */
export function computeFriction(
  runs: VerificationRunRow[],
  capturedAt: Date
): { verificationRounds: number | null; sendBackCount: number | null } {
  const cut = capturedAt.getTime()
  const upToDelivery = runs.filter(r => r.createdAt.getTime() <= cut)
  if (upToDelivery.length === 0) {
    return { verificationRounds: null, sendBackCount: null }
  }
  const verificationRounds = Math.max(...upToDelivery.map(r => r.round))
  const sendBackCount = upToDelivery.filter(r => r.verdict === 'FAIL').length
  return { verificationRounds, sendBackCount }
}

/**
 * Value-neutral bucket derived from the two frozen raw scalars. Null rounds (no
 * verification record by capture) is its own bucket, NEVER folded into
 * single-round — reading silence as a pass is the session invariant this guards.
 * Boundaries are retunable here without re-freezing (only the raw scalars are
 * immutable).
 */
export function deriveFrictionBucket(
  verificationRounds: number | null,
  sendBackCount: number | null
): FrictionBucket {
  if (verificationRounds === null) return 'no-verification'
  if (verificationRounds >= 2 || (sendBackCount ?? 0) >= 1) {
    return 'multi-round-or-sendback'
  }
  return 'single-round'
}
