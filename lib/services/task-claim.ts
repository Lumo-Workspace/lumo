/**
 * The agent's CLAIM (LUM-564, 規律2 声称vs核验): what the agent SAYS it did,
 * surfaced beside the measured verification verdict so the report shows both
 * columns instead of only the verification one. Kept in its own dependency-free
 * module so it stays unit-testable without dragging in the verification
 * service's heavy import chain (github/octokit ESM, LUM jest trap).
 *
 * LUM-574: the DIGEST fallback drops any turn note that is the summarizer's
 * meta-reasoning (`filterMetaReasoning`), so a leaked "我们被要求…" preamble is
 * never surfaced as the claim; a digest left empty after filtering degrades to
 * the same null/pending claim as "no turn notes yet".
 *
 * Sourced (LUM-573) from the AUTHORITATIVE session for the task — the session
 * carrying a MERGED lineage edge (the delivery run), frozen at DONE/idle into a
 * task-level snapshot — else, before a snapshot exists, the latest session's
 * material. Within a session the text follows the SAME two-layer rule the web
 * delivery card uses for `latestRunSummary` (the LLM-synthesized run summary
 * (LUM-481), else the raw per-turn STOP digest), so the CLI claim and the web
 * claim are same-source and cannot drift. A claim is an unverified self-report
 * (estimate-tier provenance), never a measurement.
 */
import { filterMetaReasoning } from '@/lib/services/meta-reasoning'

export interface TaskClaim {
  /** The agent's self-reported account, or null when nothing was generated. */
  text: string | null
  /** Provenance of `text` (LUM-597 取数分层, preference AGENT > RUN_SUMMARY >
   *  DIGEST > null):
   *  - 'AGENT'       = the agent's OWN required self-report, attached to the
   *    verify action and frozen when the task flips to IN_REVIEW. This is the
   *    authoritative claim — what faithfulness judges (the汇报者's own words).
   *  - 'RUN_SUMMARY' = a summarizer LLM's one-paragraph paraphrase of the
   *    session event stream (SYNTHESIZED fallback when no self-report exists).
   *  - 'DIGEST'      = the raw STOP turn digest (no LLM summary yet).
   *  - null          = nothing (no session / no turn notes / no self-report).
   *  Every populated source is an unverified self-report — estimate-tier,
   *  distinct from the measured verdict; only AGENT is the汇报者's own voice. */
  source: 'AGENT' | 'RUN_SUMMARY' | 'DIGEST' | null
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
  const digest = filterMetaReasoning(material.turnSummaries)
    .slice(-CLAIM_DIGEST_MAX_LINES)
    .join(' · ')
  if (digest) return { text: digest, source: 'DIGEST' }
  return { text: null, source: null }
}

/**
 * The frozen task-level claim snapshot (LUM-573), as stored on the Task. A
 * `synthesized` snapshot is authoritative — its `text` may legitimately be null
 * (the delivery session had no material), which is a fail-closed answer, NOT a
 * cue to fall back to the live latest-session claim.
 */
export interface ClaimSnapshot {
  text: string | null
  source: TaskClaim['source']
  /** True once the snapshot has been synthesized & frozen (DONE/idle). */
  synthesized: boolean
}

/**
 * Resolve the claim the acceptance read model exposes (LUM-573), degrading to a
 * field read: when the task's snapshot has been synthesized, return it verbatim
 * (the authoritative, merged-session claim) — no cross-session live query, and
 * a null snapshot text stays null (fail-closed). Only when no snapshot exists
 * yet (e.g. an in-progress task) does it fall back to the live latest-session
 * material via {@link selectClaim}. Pure — same input, same output — so the CLI
 * and web claim stay same-source through `TaskAcceptanceStatus.claim`.
 */
export function resolveClaimForReadModel(
  snapshot: ClaimSnapshot | null,
  liveMaterial: { runSummary: string | null; turnSummaries: string[] } | null
): TaskClaim {
  if (snapshot?.synthesized) {
    return { text: snapshot.text, source: snapshot.source }
  }
  return selectClaim(liveMaterial)
}
