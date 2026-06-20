/**
 * The agent's CLAIM (LUM-564, 規律2 声称vs核验): what the agent SAYS it did,
 * surfaced beside the measured verification verdict so the report shows both
 * columns instead of only the verification one. Kept in its own dependency-free
 * module so it stays unit-testable without dragging in the verification
 * service's heavy import chain (github/octokit ESM, LUM jest trap).
 *
 * Sourced from the latest session — the LLM-synthesized run summary (LUM-481),
 * else the raw per-turn STOP digest — the SAME two-layer rule the web delivery
 * card uses for `latestRunSummary` (DeliveryTab), so the CLI claim and the web
 * claim are same-source and cannot drift. A claim is an unverified self-report
 * (estimate-tier provenance), never a measurement.
 */
export interface TaskClaim {
  /** The agent's self-reported account, or null when nothing was generated. */
  text: string | null
  /** Provenance of `text`: 'RUN_SUMMARY' = the LLM one-paragraph summary;
   *  'DIGEST' = the raw STOP turn digest (no LLM summary yet); null = neither
   *  (no session / no turn notes). Either populated source is an unverified
   *  agent self-report — estimate-tier, distinct from the measured verdict. */
  source: 'RUN_SUMMARY' | 'DIGEST' | null
}

/** Cap on the turn-summary digest fallback — the most recent N STOP lines,
 *  mirroring the web's deriveRunDigest MAX_LINES (LUM-481) so the same claim
 *  text reads identically in both surfaces. */
export const CLAIM_DIGEST_MAX_LINES = 5

/**
 * Select the agent's claim from the latest session's run material (LUM-564),
 * mirroring the web delivery card's two-layer rule exactly: prefer the LLM
 * `runSummary`; else join the turn digest (last {@link CLAIM_DIGEST_MAX_LINES}
 * non-empty STOP lines) into one line; else null. Pure — same input, same
 * output — so the CLI and web claim cannot drift. `material` is null when the
 * task has no session at all.
 */
export function selectClaim(
  material: { runSummary: string | null; turnSummaries: string[] } | null
): TaskClaim {
  if (!material) return { text: null, source: null }
  const summary = material.runSummary?.trim()
  if (summary) return { text: summary, source: 'RUN_SUMMARY' }
  const digest = material.turnSummaries
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .slice(-CLAIM_DIGEST_MAX_LINES)
    .join(' · ')
  if (digest) return { text: digest, source: 'DIGEST' }
  return { text: null, source: null }
}
