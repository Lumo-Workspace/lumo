/**
 * A per-fragment trust verdict derived from lineage edges (LUM-539). The signal
 * is the cross-task **judged-used track record** — of the tasks a memory appeared
 * in, in how many was it judged to have actually been used — which REPLACES the
 * old merge-rate口径 (a ~100% workspace merge base rate made merge contribution
 * non-discriminative; RFC LUM-535). A verdict is only emitted once the fragment
 * has cleared the cold-start grace (>= LINEAGE_MIN_AUDITED_TASKS audited tasks);
 * cold-start / unaudited fragments get NO verdict.
 */
export interface TrustVerdict {
  /** Distinct tasks where the fragment was judged used (used=true) — the numerator. */
  judgedUsedTasks: number
  /** Distinct tasks that returned a usage verdict (used != null). Denominator of
   * `usefulnessPct`; never-audited (used=NULL) appearances are excluded, so an
   * abstention is not negative evidence (judged-used is a lower bound). */
  auditedTasks: number
  /** Distinct tasks the fragment appeared in at all — the honest "N" of the
   * X-of-N readout. */
  appearanceTasks: number
  /** Math.round(judgedUsedTasks / auditedTasks * 100). A lower-bound usefulness
   * rate, NOT a merge rate. Consumed by the web FragmentTrustBadge (LUM-303). */
  usefulnessPct: number
  /** Proven-useful: judged used in >= LINEAGE_PROVEN_USED_TASKS distinct tasks.
   * Drives the always-keep / eviction-protection / supersede guards (a proven
   * memory is not collateral). */
  qualified: boolean
}
