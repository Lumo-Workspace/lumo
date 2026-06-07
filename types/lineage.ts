/** A per-fragment trust verdict derived from lineage edges, calibrated per
 * LUM-300: a strong `usage` signal (agent voted it used) preferred over a weak
 * `presence` signal (merely co-loaded). Unqualified fragments get NO verdict. */
export interface TrustVerdict {
  kind: 'usage' | 'presence'
  /** Denominator: distinct resolved tasks (usage → used-resolved). */
  resolvedTasks: number
  /** Numerator: distinct merged tasks (usage → used-merged). */
  mergedTasks: number
  /** Math.round(merged / resolved * 100). Consumed by the web FragmentTrustBadge (LUM-303); the CLI markdown path formats its own percentage line and does not read this. */
  pct: number
}
