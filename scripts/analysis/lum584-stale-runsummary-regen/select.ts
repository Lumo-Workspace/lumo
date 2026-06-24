/**
 * LUM-584 — pick the *stale* run-summaries that LUM-579 never re-scanned.
 *
 * LUM-579 fixed run-summary generation (full event stream, not the sparse
 * `turnSummary` field) and regenerated a batch of known negative claims. But
 * tasks whose claim snapshot was frozen BEFORE 579 deployed — and that 579's
 * rollout didn't re-scan — still carry the old, early-biased "no code change"
 * summary even though their delivery session genuinely changed code (the
 * LUM-540 / #635 case is the hard anchor: 8.17M Write + 4.9M Edit tokens, yet
 * the claim says "未包含具体的代码变更").
 *
 * This module is the target SELECTOR only — a pure function over rows the
 * enumerator assembles from prod (a 582 verdict + the anchor session's
 * Write/Edit count + a generation timestamp). Kept pure and free of Prisma so
 * the include/exclude logic is unit-tested without a DB. `enumerate.ts` wires
 * it to prod; `scripts/analysis/lum579-run-summary-underreport/regenerate.ts
 * --tasks <list> --apply` does the actual regeneration.
 */

/**
 * LUM-579 (#706) merged 2026-06-24 07:50Z; the regeneration backfill ran after
 * that. A claim frozen at/after this instant came from the FIXED full-event
 * path — if it is still UNDERREPORT it is a deeper post-579 problem, not a
 * stale summary, so regeneration is not expected to fix it. A claim frozen
 * before this (or with no timestamp) is the stale-bad population this task
 * repairs.
 */
export const LUM_579_DEPLOY_CUTOFF = new Date('2026-06-24T07:50:00Z')

/** One candidate task, as assembled from prod by enumerate.ts. */
export interface VerdictTargetRow {
  identifier: string
  taskId: string
  /** The persisted LUM-582 ClaimFaithfulnessVerdict.verdict. */
  verdict: string
  /** The anchor (claimSnapshotSessionId) session, or null if unsynthesized. */
  anchorSessionId: string | null
  /** Count of Write/Edit HookEvents in the anchor session. */
  writeEditCount: number
  /**
   * When the stale-suspect claim was produced: the anchor session's
   * `runSummaryGeneratedAt`, falling back to the task's `claimSnapshotAt`.
   * Null when neither is recorded (legacy rows) — treated as stale (unknown
   * provenance, and regeneration is idempotent-safe).
   */
  generatedAt: Date | null
}

export type TargetClassification =
  /** Not a 582 UNDERREPORT — out of scope. */
  | 'NOT_UNDERREPORT'
  /** UNDERREPORT but the anchor session changed no files — reverse gate: a
   *  genuine non-delivery, must NOT be rewritten into a fabricated delivery. */
  | 'NO_OP_SKIP'
  /** UNDERREPORT with delivery but the claim post-dates the 579 fix — a deeper
   *  problem regeneration won't repair, not a stale summary. */
  | 'POST_579_SKIP'
  /** UNDERREPORT + real Write/Edit delivery + pre-579 (or unknown) timestamp —
   *  the repairable stale-bad case. Regenerate. */
  | 'STALE_REGEN'

/**
 * Classify one candidate. The order encodes the gates: scope → reverse gate →
 * staleness. Only STALE_REGEN tasks are regenerated.
 */
export function classifyTarget(
  row: VerdictTargetRow,
  cutoff: Date = LUM_579_DEPLOY_CUTOFF
): TargetClassification {
  if (row.verdict !== 'UNDERREPORT') return 'NOT_UNDERREPORT'
  // Reverse gate: no Write/Edit in the delivery session => genuine no-op.
  // Excluded so regeneration can never manufacture a delivery narrative for a
  // run that delivered nothing.
  if (row.writeEditCount < 1) return 'NO_OP_SKIP'
  // Post-579 claims came from the fixed path; a residual UNDERREPORT there is a
  // deeper issue, out of this task's scope.
  if (row.generatedAt !== null && row.generatedAt.getTime() >= cutoff.getTime())
    return 'POST_579_SKIP'
  return 'STALE_REGEN'
}

/** The subset to regenerate: UNDERREPORT ∧ has Write/Edit delivery ∧ pre-579. */
export function selectStaleRegenTargets(
  rows: VerdictTargetRow[],
  cutoff: Date = LUM_579_DEPLOY_CUTOFF
): VerdictTargetRow[] {
  return rows.filter(r => classifyTarget(r, cutoff) === 'STALE_REGEN')
}
