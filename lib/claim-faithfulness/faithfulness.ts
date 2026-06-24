/**
 * LUM-583 — the read-model derivation of the claim-faithfulness third state.
 *
 * LUM-564 put the agent's CLAIM (声称) next to the measured VERIFICATION (核验)
 * as two columns, but the report never said whether the claim itself was true.
 * LUM-582 produced that judgement — an independent claim↔git-diff verdict
 * (FAITHFUL / UNDERREPORT / OVERSTATED / UNJUDGEABLE) persisted per task in
 * `ClaimFaithfulnessVerdict`. This module maps a persisted verdict row (already
 * fetched — never an LLM call at read time) into the shape the acceptance read
 * model exposes, adding the two NON-verdict states the UI needs:
 *
 *  - PENDING — no verdict row exists yet (the batch judge hasn't run for this
 *    task). Deliberately distinct from UNJUDGEABLE, which is a real verdict the
 *    judge reached (it looked and couldn't decide). "Not yet judged" ≠ "judged
 *    as undecidable".
 *  - STALE — a verdict exists but was judged against an OLDER claim than the
 *    task's current `claimSnapshotAt` (or predates staleness tracking with a
 *    null `judgedClaimAt`). The verdict value is still surfaced, flagged stale,
 *    pending the next batch re-judge. Mirrors the audit's `--resume` freshness
 *    rule (lib/repositories/claim-faithfulness-verdict.repository.ts).
 *
 * Pure — same input, same output, dependency-free — so it stays unit-testable
 * without dragging in Prisma or the verifier's import chain.
 */
import type { ClaimVerdict } from './types'

/** The four judged verdicts plus the two read-model-only states the UI shows. */
export type ClaimFaithfulnessState = ClaimVerdict | 'PENDING' | 'STALE'

/** The persisted-verdict fields the derivation reads. A decoupled view of the
 *  Prisma `ClaimFaithfulnessVerdict` row so callers can pass a plain object. */
export interface FaithfulnessVerdictInput {
  verdict: string
  /** Stored as Json (string[] of evidence pointers); read defensively. */
  evidence: unknown
  reasoning: string | null
  diffShas: string[]
  prNumbers: number[]
  judgedAt: Date
  /** Watermark: the claimSnapshotAt the verdict was judged against. */
  judgedClaimAt: Date | null
}

/** The claim-faithfulness slice of the acceptance read model. */
export interface ClaimFaithfulness {
  state: ClaimFaithfulnessState
  /** The underlying persisted verdict, surfaced even when STALE; null when
   *  PENDING (nothing has been judged yet). */
  verdict: ClaimVerdict | null
  /** Free-text evidence pointers the judge cited; [] when none / pending. */
  evidence: string[]
  reasoning: string | null
  /** Structured pointers into the delivery the judge measured against. */
  diffShas: string[]
  prNumbers: number[]
  judgedAt: string | null
  judgedClaimAt: string | null
}

const JUDGED_VERDICTS: ReadonlySet<string> = new Set<ClaimVerdict>([
  'FAITHFUL',
  'UNDERREPORT',
  'OVERSTATED',
  'UNJUDGEABLE',
])

const PENDING: ClaimFaithfulness = {
  state: 'PENDING',
  verdict: null,
  evidence: [],
  reasoning: null,
  diffShas: [],
  prNumbers: [],
  judgedAt: null,
  judgedClaimAt: null,
}

function coerceEvidence(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

/**
 * A persisted verdict is STALE when it was judged against a claim older than the
 * task's current snapshot. A null `claimSnapshotAt` means nothing newer exists
 * to judge → fresh; a null `judgedClaimAt` predates staleness tracking → stale.
 * (The inverse of the repository's `isFreshVerdict`, kept here so this module
 * stays Prisma-free.)
 */
function isStale(
  judgedClaimAt: Date | null,
  claimSnapshotAt: Date | null
): boolean {
  if (claimSnapshotAt === null) return false
  if (judgedClaimAt === null) return true
  return judgedClaimAt.getTime() < claimSnapshotAt.getTime()
}

/**
 * Derive the claim-faithfulness read-model slice from a persisted verdict row
 * (or null) and the task's current claim-snapshot watermark. Read-only: takes
 * already-fetched data, never judges.
 */
export function deriveFaithfulness(
  row: FaithfulnessVerdictInput | null,
  claimSnapshotAt: Date | null
): ClaimFaithfulness {
  if (!row) return PENDING
  // A row written with an out-of-range string can't crash the read model; an
  // unrecognised verdict degrades to UNJUDGEABLE rather than leaking a raw value.
  const verdict: ClaimVerdict = JUDGED_VERDICTS.has(row.verdict)
    ? (row.verdict as ClaimVerdict)
    : 'UNJUDGEABLE'
  const stale = isStale(row.judgedClaimAt, claimSnapshotAt)
  return {
    state: stale ? 'STALE' : verdict,
    verdict,
    evidence: coerceEvidence(row.evidence),
    reasoning: row.reasoning,
    diffShas: row.diffShas,
    prNumbers: row.prNumbers,
    judgedAt: row.judgedAt.toISOString(),
    judgedClaimAt: row.judgedClaimAt ? row.judgedClaimAt.toISOString() : null,
  }
}
