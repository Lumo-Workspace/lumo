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
 * Catalog probed 2026-06-24: `anthropic/claude-sonnet-4.6` resolves. Do NOT
 * "normalise" the gateway dot to a dash — `anthropic/claude-sonnet-4-6` is NOT
 * in the catalog and would 400.
 */

/**
 * 桶1 VERIFIER tier — high-value adversarial judging where a wrong call is
 * invisible and expensive: claim-faithfulness, contract-weakening, silent-fix,
 * spinoff, test-tampering judges + action-confirm. Pinned to Sonnet; NEVER
 * swap this tier to a cheaper model without passing the lineage A/B gate
 * (LUM-588). Gateway format.
 */
export const REASONING_MODEL = 'anthropic/claude-sonnet-4.6'

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
 * the gateway (LUM-592). Doubles as the `contentModel` value stamped on the
 * session record. Gateway format.
 */
export const CONTENT_MODEL = 'anthropic/claude-sonnet-4.6'

/**
 * Lightweight translation (i18n Slack-context tooling). Routed to DeepSeek via
 * the gateway (LUM-587) — same FAST tier as memory/classifier work; the prior
 * Haiku pin bought no quality here and cost more. Gateway format.
 */
export const TRANSLATION_MODEL = 'deepseek/deepseek-v4-flash'

/**
 * High-frequency, cost-sensitive tier — memory extract/fold/ground/curate/
 * dedup/canonicalize, session classifier, turn-digest, content summary,
 * lineage usage-judge. Routed to DeepSeek via the gateway (LUM-320) to cut
 * cost vs the prior Haiku tier. Gateway format.
 */
export const FAST_MODEL = 'deepseek/deepseek-v4-flash'

/**
 * The embedding model id lives in `./embedding` (`EMBEDDING_MODEL`), coupled to
 * `EMBEDDING_DIM` and the pgvector column width. It is deliberately NOT
 * re-exported here: that module statically imports `@ai-sdk/gateway`, whereas
 * this registry stays a zero-runtime-dependency string module so any service
 * can import a model id without pulling the gateway (and its jest-hostile
 * TransformStream) into scope.
 */
