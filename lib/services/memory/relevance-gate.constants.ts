// lib/services/memory/relevance-gate.constants.ts

/**
 * Max project memories the gate keeps by similarity (LUM-486). "Tight" cap —
 * a narrow task should pull a handful of relevant memories, not the whole
 * corpus. Always-kept high-trust fragments are unioned on top of this.
 */
export const RELEVANCE_GATE_TOP_K = 8

/**
 * Min cosine similarity (1 - distance) for the embedding path. NOTE this is a
 * task↔memory match (looser than the fact↔fact extraction match), so it is
 * deliberately below the extraction floor (EMBEDDING_SCORE_FLOOR = 0.74). Seed
 * value; re-derive with the calibration in memory-relevance-gate-eval.test.ts
 * and dogfood (LUM-486).
 */
export const RELEVANCE_GATE_EMBED_FLOOR = 0.5

/** Min bigram similarity for the lexical fallback path (mirrors the extraction
 * lexical floor of 0.3 — incidental letter-pair overlap is not relevance). */
export const RELEVANCE_GATE_LEXICAL_FLOOR = 0.3

// LUM-539: the trust always-keep threshold is no longer a merge percentage. A
// memory is always-kept when its judged-used track-record verdict is `qualified`
// (judged used in >= LINEAGE_PROVEN_USED_TASKS distinct tasks). That gate lives
// in lib/services/lineage-signal.ts; the merge-rate constants are retired.
