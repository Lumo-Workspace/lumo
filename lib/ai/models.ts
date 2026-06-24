/**
 * Central LLM model registry. Every chat/completion call site imports its id
 * from here — never inline a model-id string at the call site (LUM-587).
 *
 * Two distinct id spaces live here; do NOT mix them:
 *  - **Gateway format** (provider-prefixed, e.g. `anthropic/claude-sonnet-4.6`)
 *    — passed to `@ai-sdk/gateway`'s `gateway('<id>')`.
 *  - **Native Anthropic SDK format** (bare, e.g. `claude-opus-4-8`) — passed to
 *    `@anthropic-ai/sdk`'s `client.messages.create({ model })`. Prefixing this
 *    with `anthropic/` would 400 the native API.
 *
 * Upgrade note (LUM-587): Sonnet 4.5→4.6 and Opus 4.7→4.8 were bumped without
 * an online Gateway probe — if judge/summary calls start 400-ing after deploy,
 * a model-id alias is the first suspect.
 */

/**
 * High-value reasoning / judging / summarisation tier — judges (claim
 * faithfulness, contract weakening, silent fix, spinoff, test tampering,
 * action confirm), run/sprint/milestone summaries, description & dispatch &
 * duplicate-check services, task suggest-priority / decompose routes.
 * Gateway format.
 */
export const REASONING_MODEL = 'anthropic/claude-sonnet-4.6'

/**
 * Session-summary structured content generation. Driven via the **native
 * Anthropic SDK** (`client.messages.create`), so this MUST stay bare — no
 * `anthropic/` prefix. Doubles as the `contentModel` value stamped on the
 * session record.
 */
export const CONTENT_MODEL = 'claude-opus-4-8'

/** Lightweight translation (i18n Slack-context tooling). Gateway format. */
export const TRANSLATION_MODEL = 'anthropic/claude-haiku-4-5'

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
