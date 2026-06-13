export interface UsageSignalHealth {
  distribution: { used: number; unused: number; abstained: number }
  /** Population variance of per-session (used / injected) across sessions that
   *  carry ≥1 vote. ~0 means the judge is acting like a constant. */
  perSessionVariance: number
  votedSessions: number
  /** Task-deduped merge rate among used=true edges vs the base resolved rate,
   *  computed over the LUM-484 iteration-taint fold (a task with a send-back /
   *  reopen / PR-close counts as non-merged even if later merged). usedMergeRate
   *  meaningfully above baseMergeRate ⇒ the signal discriminates. */
  usedMergeRate: number | null
  baseMergeRate: number | null
  usedResolvedTasks: number
  baseResolvedTasks: number
  /** Size of the negative class (resolved-but-not-merged after taint). 0 ⇒ no
   *  failure outcomes exist yet, so the rates cannot discriminate (LUM-484). */
  usedFailedTasks: number
  baseFailedTasks: number
}
