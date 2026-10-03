export interface UsageSignalHealth {
  distribution: { used: number; unused: number; abstained: number }
  /** Population variance of per-session (used / injected) across sessions that
   *  carry ≥1 vote. ~0 means the judge is acting like a constant. */
  perSessionVariance: number
  votedSessions: number
  /** Task-deduped merge rate among used=true edges vs the base resolved rate,
   *  computed over the LUM-484 iteration-taint fold: a resolved task carrying a
   *  judge-confirmed laundering crossing is recounted as non-merged even if it
   *  later completed (REWORKED/REJECTED tasks already fold as non-merged via
   *  their edge outcomes). usedMergeRate meaningfully above baseMergeRate ⇒ the
   *  signal discriminates. */
  usedMergeRate: number | null
  baseMergeRate: number | null
  usedResolvedTasks: number
  baseResolvedTasks: number
  /** Size of the negative class (resolved-but-not-merged after taint). 0 ⇒ no
   *  failure outcomes exist yet, so the rates cannot discriminate (LUM-484). */
  usedFailedTasks: number
  baseFailedTasks: number
  /** Raw count of TASK_SPUN_OFF events (mid-flight --new-scope spinoffs) across
   *  the workspace. Informational only — NOT folded into the merge-rate; the
   *  judge-gated negative-class counting lands in LUM-511 Phase 4. */
  spinoffsDuringInFlight: number
  /** LUM-521 workspace-wide progressive-disclosure funnel (edge-level counts).
   *  impressions = all edges; index = INDEX-disclosed; pulled = INDEX edges
   *  whose body was pulled; used = used=true. The CLI derives the percentages
   *  (pull% over index, index%/used% over impressions). */
  disclosureFunnel: {
    impressions: number
    index: number
    pulled: number
    used: number
    /** LUM-522: Σ(fullTokens − indexTokens) over un-pulled INDEX edges with
     *  token data. Null when no workspace edge carries token columns yet. */
    tokensSaved: number | null
  }
}
