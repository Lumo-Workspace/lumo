/**
 * Central LLM model registry. Every chat/completion call site imports its id
 * from here — never inline a model-id string at the call site (LUM-587).
 *
 * All ids are **gateway format** (provider-prefixed, e.g.
 * `anthropic/claude-sonnet-4.6`) — passed to `@ai-sdk/gateway`'s
 * `gateway('<id>')`. The native-`@anthropic-ai/sdk` bare-id exception for
 * session-summary was removed in 桶3/LUM-592; every call site now routes the
 * gateway, so there is a single id space.
 *
 * Catalog probed 2026-06-24 / 2026-09-10: `anthropic/claude-sonnet-4.6` and
 * `zai/glm-5.2` resolve. Do NOT "normalise" the gateway dot to a dash —
 * `anthropic/claude-sonnet-4-6` / `zai/glm-5-2` are NOT in the catalog and
 * would 400.
 */

/**
 * 桶1 VERIFIER tier — high-value adversarial judging where a wrong call is
 * invisible and expensive: claim-faithfulness, contract-weakening, silent-fix,
 * spinoff, test-tampering judges + action-confirm. Swapped from Sonnet 4.6 to
 * GPT-5.5 — the LUM-588 lineage A/B gate ("NEVER swap without passing the gate")
 * was explicitly WAIVED by the user for this change; no judge A/B harness exists
 * yet, so this ships on a catalog-resolve probe only (gateway returned a clean
 * completion 2026-06-27), NOT an accuracy eval. Gateway format; keep the version
 * dot (`openai/gpt-5.5`), do NOT dash-normalise.
 */
export const REASONING_MODEL = 'openai/gpt-5.5'

/**
 * 桶2 GENERATION tier — lower-stakes structured generation where the quality
 * floor is the lowest: run/sprint/milestone summaries, summaries/report,
 * description & quick-dispatch & duplicate-check services, task
 * suggest-priority / decompose routes. Migrated off Sonnet to DeepSeek V4-Pro
 * (LUM-588) — catalog-confirmed 2026-06-24. Kept distinct from REASONING_MODEL
 * so the verifier tier (桶1) can never be cheapened by editing one shared
 * constant. Gateway format.
 */
export const GENERATION_MODEL = 'deepseek/deepseek-v4-pro'

/**
 * 桶3 CONTENT tier — session-summary structured content generation (6 forced-
 * schema templates). Dropped Opus + the native Anthropic SDK for Sonnet 4.6 via
 * the gateway (LUM-592); then Sonnet 4.6 → GLM-5.2 (LUM-748) — the LUM-588
 * lineage A/B gate was explicitly WAIVED by the user for this swap; it ships on
 * a 6-template `generateObject` schema-conformance probe
 * (`scripts/probe-glm-structured.ts --templates`), NOT an accuracy eval.
 * GLM-5.2, not 5.3: sampled on the debug template, 5.3 degenerated into a
 * whitespace loop mid-JSON until the token cap (5/53 default sampling, 1/56 at
 * temperature 0 → AI_NoObjectGeneratedError); 5.2 was 0/120. Doubles as the
 * `contentModel` value stamped on the session record. Gateway format;
 * catalog-probed 2026-09-10 (`zai/glm-5.2` resolves — keep the version dot,
 * do NOT dash-normalise).
 */
export const CONTENT_MODEL = 'zai/glm-5.2'

/**
 * Lightweight translation (i18n Slack-context tooling). Routed to DeepSeek via
 * the gateway (LUM-587) — same FAST tier as memory/classifier work; the prior
 * Haiku pin bought no quality here and cost more. Gateway format.
 */
export const TRANSLATION_MODEL = 'deepseek/deepseek-v4-flash'

/**
 * High-frequency, cost-sensitive tier — memory layer1-extract / ground /
 * canonicalize, session classifier, turn-digest, content summary, lineage
 * usage-judge. Routed to DeepSeek via the gateway (LUM-320) to cut cost vs the
 * prior Haiku tier. Gateway format.
 */
export const FAST_MODEL = 'deepseek/deepseek-v4-flash'

/**
 * 桶4 MEMORY_JUDGE tier — memory reconciliation judgments (curation-judge,
 * fold-compute, layer2-extract, manual-dedup) where a sharper model improves
 * merge/keep decisions. Split off FAST_MODEL onto DeepSeek V4-Pro (LUM-591),
 * catalog-confirmed 2026-06-24. NOTE: the decision-table "强制 eval" gate was
 * explicitly WAIVED by the user (no judge A/B harness exists yet) — this swap
 * ships on a structured-output probe only, not an accuracy eval. Gateway format.
 */
export const MEMORY_JUDGE_MODEL = 'deepseek/deepseek-v4-pro'

/**
 * 桶5 POLICY_COMPILER tier — compiling a project's CLAUDE.md/AGENTS.md into
 * classified PolicyRule records (LUM-590). This single run-at-rest, hash-cached
 * call drives the whole per-project detector — the quality of its action/code +
 * deterministic/semantic classification and its predicate/built-in mapping
 * decides what the deterministic-block tier can catch at all. Run-at-rest +
 * cached, so cost is bounded (once per project per CLAUDE.md change) and
 * accuracy dominates. Kept its own constant so it never shares — and so can
 * never be cheapened by — the verifier (桶1) tier.
 *
 * Opus 4.8 → GLM-5.2 (LUM-748): the LUM-588 A/B gate was explicitly WAIVED by
 * the user; ships on a CLAUDE.md classification probe
 * (`scripts/probe-glm-structured.ts --policy`) that asserts the Forbidden
 * rules map to their built-ins, NOT an accuracy eval (3/3 runs mapped all four
 * Forbidden rules, 0 prose misclassified). Same 5.2-over-5.3 reasoning as
 * CONTENT_MODEL — 5.3's whitespace-loop degeneration has more exposure on
 * this longer output. Gateway format; catalog-probed 2026-09-10
 * (`zai/glm-5.2` resolves — keep the version dot, do NOT dash-normalise).
 */
export const POLICY_COMPILER_MODEL = 'zai/glm-5.2'

/**
 * The embedding model id lives in `./embedding` (`EMBEDDING_MODEL`), coupled to
 * `EMBEDDING_DIM` and the pgvector column width. It is deliberately NOT
 * re-exported here: that module statically imports `@ai-sdk/gateway`, whereas
 * this registry stays a zero-runtime-dependency string module so any service
 * can import a model id without pulling the gateway (and its jest-hostile
 * TransformStream) into scope.
 */
