export interface UsageSignalHealth {
  distribution: { used: number; unused: number; abstained: number }
  /** Population variance of per-session (used / injected) across sessions that
   *  carry ≥1 vote. ~0 means the judge is acting like a constant. */
  perSessionVariance: number
  votedSessions: number
  /** Task-deduped merge rate among used=true edges vs the base resolved rate.
   *  usedMergeRate meaningfully above baseMergeRate ⇒ the signal discriminates. */
  usedMergeRate: number | null
  baseMergeRate: number | null
  usedResolvedTasks: number
  baseResolvedTasks: number
}
