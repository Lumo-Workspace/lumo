/**
 * LUM-618 — pair a frozen claim with the delivery it actually describes.
 *
 * `Task.claimSnapshot` is overwritten by the LATEST `lumo verify --note`
 * (LUM-597). The claim-faithfulness delivery resolver (LUM-612), meanwhile,
 * builds the delivery from the task's MERGED PRs. Those two can describe
 * different work: a task that merged PR-A and then opened a follow-up PR-B has
 * its claim overwritten to describe PR-B, but PR-B is still open, so the
 * resolver only sees PR-A. Judging PR-B's claim against PR-A's diff reads the
 * claim as "saying more than the diff" → a false OVERSTATED that self-heals
 * only when PR-B merges, polluting the very metric faithfulness exists to build.
 *
 * The discriminator (same DB fact the LUM-573 claim-source family already
 * trusts): a session carries a MERGED lineage edge ⟺ it injected context for
 * work that merged = it delivered. So the claim describes a merged delivery iff
 * the session that produced the claim is itself one of the task's
 * merged-delivery sessions.
 *
 * `isClaimDeliveryMismatch` is the gate: true ⇒ the claim came from a session
 * that has NOT merged while a DIFFERENT session's delivery has → do not judge
 * the claim against that mismatched delivery. Conservative by construction — it
 * never fires when:
 *   - the claim has no session pointer (legacy / synthesized snapshot) — can't
 *     pair, so fall through to the unchanged behaviour; or
 *   - there are no merged-delivery sessions yet (pre-merge; the resolver returns
 *     a null delivery and the classifier already yields UNJUDGEABLE); or
 *   - the claim's session IS one of the merged-delivery sessions (it delivered).
 *
 * Pure — no Prisma, no IO — so the gate is unit-testable in isolation.
 */
export function isClaimDeliveryMismatch(
  claimSnapshotSessionId: string | null | undefined,
  mergedSessionIds: readonly string[]
): boolean {
  if (!claimSnapshotSessionId) return false
  if (mergedSessionIds.length === 0) return false
  return !mergedSessionIds.includes(claimSnapshotSessionId)
}
