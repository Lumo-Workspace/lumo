/**
 * PURE — the agentic verifier's rules, shared by every surface (LUM-988).
 *
 * The verifier reads the repository and confirms or rejects each AI-review
 * (LLM_JUDGE) finding. A REJECTED row is kept and stays visible in Lumo with
 * its reason, but it is no longer an open finding: no inline PR comment, not
 * in the summary's counts, not in the agent reminders or `task status`.
 * One predicate, so those surfaces cannot disagree about what "rejected" is.
 */

export type VerifierVerdict = 'CONFIRMED' | 'REJECTED'

/**
 * A finding the verifier rejected. `undefined` (a projection written before
 * the column existed) and `null` (not verified) both read as not rejected,
 * and only LLM_JUDGE rows can be rejected — a stray verdict on any other row
 * is ignored rather than allowed to hide a deterministic finding.
 */
export function isVerifierRejected(f: {
  provenance: string
  verifierVerdict?: VerifierVerdict | null
}): boolean {
  return f.provenance === 'LLM_JUDGE' && f.verifierVerdict === 'REJECTED'
}

/**
 * How long the PR write-back holds the inline comments of the findings the
 * verifier may reject, for a verifier that has started but not finished.
 * Sized to the run's real worst case, not its median: waiting for the managed
 * scan's VM to appear (30 s) and to finish (90 s), the checkout wait (20 s),
 * booting its own VM when that fails (~60 s), the agent's call
 * (VERIFIER_TIMEOUT_MS, 180 s) and 60 s of margin for workflow queueing ≈ 8
 * minutes. A run that is lost altogether is released by the stale-hold sweep
 * (`reviewVerifierOpsService.sweepStaleHolds`); a verdict that lands after
 * the window edits the comment it can no longer hold back.
 */
export const VERIFIER_HOLD_MS = 8 * 60_000

/** The verifier's model call (all findings of one scan, one agent). */
export const VERIFIER_TIMEOUT_MS = 180_000

/** Tool-call steps for one scan's findings; the replay median used 4. */
export const VERIFIER_MAX_STEPS = 16

/** Diff of the cited files handed to the verifier, at most this many chars. */
export const VERIFIER_DIFF_MAX_CHARS = 60_000

/** Is the write-back still waiting on this scan's verifier? */
export function verifierHolding(
  scan: {
    verifierStartedAt: Date | string | null
    verifiedAt: Date | string | null
  },
  now: number
): boolean {
  if (scan.verifierStartedAt == null || scan.verifiedAt != null) return false
  return now - new Date(scan.verifierStartedAt).getTime() < VERIFIER_HOLD_MS
}

/**
 * Which verdicts are applied. Measured on the Martian replay (LUM-988):
 * applying every rejection cost too much recall (F2 59.6), while keeping HIGH
 * and security findings regardless of the verdict held F2 above 60 and raised
 * F1 by ~3 points. So only a non-HIGH CORRECTNESS finding can be rejected;
 * every other row keeps no verdict at all (it is not "confirmed" either —
 * the policy simply does not consult the verifier for it).
 */
export function verifierAppliesTo(f: {
  kind: string
  severity: string
}): boolean {
  return f.kind === 'CORRECTNESS' && f.severity !== 'HIGH'
}

/** The verdicts to persist: the applicable ones, keyed by finding id. */
export function applyVerifierPolicy<
  F extends { id: string; kind: string; severity: string },
>(
  findings: readonly F[],
  results: ReadonlyArray<{
    id: string
    verdict: VerifierVerdict
    reason: string
    defaulted: boolean
  }>
): Array<{ findingId: string; verdict: VerifierVerdict; reason: string }> {
  const byId = new Map(findings.map(f => [f.id, f]))
  return results.flatMap(r => {
    const f = byId.get(r.id)
    if (!f || r.defaulted || !verifierAppliesTo(f)) return []
    return [{ findingId: f.id, verdict: r.verdict, reason: r.reason }]
  })
}

/**
 * The finding kind the verifier is told: the model's own review kind from the
 * rule id (`review:logic_error` → `logic_error`, `vuln:xss` → `xss`), which
 * is what the replay measured — not the coarse stored kind.
 */
export function verifierKindOf(ruleId: string): string {
  if (ruleId === 'secret:llm-hardcoded-credential')
    return 'hardcoded_credential'
  const i = ruleId.indexOf(':')
  return i >= 0 ? ruleId.slice(i + 1) : ruleId
}
