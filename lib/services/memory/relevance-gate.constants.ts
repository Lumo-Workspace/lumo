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
 * deliberately below the extraction floor (EMBEDDING_SCORE_FLOOR = 0.78). Seed
 * value; re-derive with the calibration in memory-relevance-gate-eval.test.ts
 * and dogfood (LUM-486).
 */
export const RELEVANCE_GATE_EMBED_FLOOR = 0.5

/** Min bigram similarity for the lexical fallback path (mirrors the extraction
 * lexical floor of 0.3 — incidental letter-pair overlap is not relevance). */
export const RELEVANCE_GATE_LEXICAL_FLOOR = 0.3

/** Always-keep a project memory whose historical merge-contribution clears this
 * percentage over >= RELEVANCE_GATE_TRUST_MIN_TASKS resolved tasks, even if a
 * narrow task's similarity drops it. Proven-useful memory is not collateral. */
export const RELEVANCE_GATE_TRUST_KEEP_PCT = 80

/** Minimum resolved-task sample size before a fragment's merge-rate is trusted
 * enough to always-keep — guards against a high rate computed from 1–2 tasks. */
export const RELEVANCE_GATE_TRUST_MIN_TASKS = 3
