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
 * invisible and expensive: claim-faithfulness judge + action-confirm
 * (the contract-weakening / silent-fix / spinoff / test-tampering judges were
 * removed in LUM-942). Swapped from Sonnet 4.6 to
 * GPT-5.5 — the LUM-588 lineage A/B gate ("NEVER swap without passing the gate")
 * was explicitly WAIVED by the user for this change; no judge A/B harness exists
 * yet, so this ships on a catalog-resolve probe only (gateway returned a clean
 * completion 2026-06-27), NOT an accuracy eval. Gateway format; keep the version
 * dot (`openai/gpt-5.5`), do NOT dash-normalise.
 */
export const REASONING_MODEL = 'openai/gpt-5.5'

/**
 * CODE_REVIEW tier — the PR scan's AI review layer (`judgeSecurity` in
 * `lib/llm/security-judge-client.ts`): one structured call that reviews the
 * diff plus the PR-head content of the changed files for security defects,
 * correctness bugs, code contradicting its own docs and tests that cannot
 * catch their bug (LUM-988). Split off REASONING_MODEL so the review can move
 * without touching the eight verifier clients that share that constant.
 *
 * GPT-5.5 → Claude Sonnet 5.5 on the LUM-975 replay of the Martian Code
 * Review Bench offline set (50 PRs, Core profile): sonnet + changed-file
 * context F1 52.5 / F2 64.2 under the Opus 4.5 judge and F1 52.8 / F2 64.3
 * under a GPT-5.2 cross-judge, vs F1 2.4 for the security-only prompt on
 * gpt-5.5. The user approved moving to Sonnet or Opus 5.5 and the cost
 * increase (LUM-975); Sonnet was picked over Opus because Opus led only under
 * the same-family judge and costs twice as much (LUM-988 Decisions, recorded
 * by the LUM-975 session). The replay harness is the internal LUM-988
 * code-review replay. Gateway format;
 * catalog-probed 2026-10-04 (`anthropic/claude-sonnet-5.5` resolves — keep
 * the version dot, do NOT dash-normalise).
 */
export const CODE_REVIEW_MODEL = 'anthropic/claude-sonnet-5.5'

/**
 * 桶 HUNT — the L3 security hunt's tool-calling search (`huntTask`: the
 * search steps and the forced wrap-up replay; the planner stays on
 * FAST_MODEL, the falsifier on its own tier). Split off GENERATION_MODEL by
 * LUM-787 so the hunt can be swapped without touching the summaries /
 * description call sites that share 桶2.
 *
 * DeepSeek V4-Pro → Qwen3-Coder-Plus (LUM-787): on the same diff (PR 1008,
 * head 02cf887c) replayed through the shipped loop after the step-budget
 * fix, seven models were compared one run each (table in
 * the internal LUM-787 hunt-replay results). Qwen3-Coder-Plus was
 * the only model that narrated every step — the only kind of memory that
 * survives transcript elision — and the only one to submit a candidate;
 * DeepSeek V4-Pro reached the same step counts but wrote no text at all
 * (reasoning only, which is not replayed). The LUM-588 lineage A/B gate was
 * explicitly WAIVED by the user for this swap; it ships on that replay
 * comparison (n = 1 per model), NOT an accuracy eval, and the hunt audit
 * row now records `model` so the swap can be read back. ~$0.05 per scan at
 * list price vs ~$0.03; catalog-resolved 2026-09-15 by the replay itself.
 *
 * Qwen3-Coder-Plus → Claude Haiku 4.5 (LUM-1084): `alibaba/qwen3-coder-plus`
 * left the gateway catalog (2026-10, `model_not_found`; production hunts
 * failed every task with "Model not exist." and covered 0/N). Nine
 * replacements were replayed on PR 1008 through the shipped loop at today's
 * allocation (800k tokens / 280 s per task), one run each (internal LUM-1084
 * replay table). Haiku 4.5 was the only one to meet the LUM-787 bar: 2/3
 * tasks `done` and the third answered at its wrap-up, 0 gate refusals, prose
 * in 71/71 steps, 187 s, ~$0.44 at list price. Chosen by the user
 * (LUM-1084 Decisions). No extended thinking: none is requested, and the
 * forced wrap-up's `toolChoice` would be refused with it. Pinned to
 * Anthropic's own API in MODEL_PROVIDER_PINS below. Gateway format; keep the
 * version dot (`anthropic/claude-haiku-4.5`), do NOT dash-normalise.
 */
export const HUNT_MODEL = 'anthropic/claude-haiku-4.5'

/**
 * LUM-988 — models whose gateway routing is pinned to the listed hosts.
 * `lib/ai/zdr-fetch.ts` forces `providerOptions.gateway.only` to this list on
 * every request for the model, at the wire, like ZDR. The gateway's default
 * ZDR failover for an Anthropic model also reaches bedrock, vertexAnthropic
 * and claudeaws, none of which is on the published subprocessor list; the
 * user chose to pin to Anthropic only rather than announce four new hosts.
 * Adding a host here is a subprocessor change: update `lib/legal/subprocessors.ts`,
 * the ZDR manifest and the legal doc, and give the notice first.
 */
export const MODEL_PROVIDER_PINS: Readonly<Record<string, readonly string[]>> =
  {
    [CODE_REVIEW_MODEL]: ['anthropic'],
    // LUM-1084 — same reason: the hunt sends customer code, and Haiku's other
    // gateway hosts (bedrock, claudeaws, vertexAnthropic) are not announced.
    [HUNT_MODEL]: ['anthropic'],
  }

/**
 * 桶2 GENERATION tier — lower-stakes structured generation where the quality
 * floor is the lowest: run/sprint/milestone summaries, summaries/report,
 * description & quick-dispatch & duplicate-check services, task
 * suggest-priority route. Migrated off Sonnet to DeepSeek V4-Pro
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
 *
 * Also the fallback for the one retry of the PR thread-reply learning
 * classifier (LUM-1139, `ee/security/llm/thread-reply-client.ts`): when the
 * FAST-tier call refuses or fails, a different, larger model gives the
 * second opinion — whether a reply becomes a stored learning is itself a
 * memory keep decision. Same ZDR-forced gateway and hosts; no new provider.
 *
 * Also the PR reviewer's pre-merge checks (LUM-1148,
 * `ee/security/llm/pre-merge-checks-client.ts`): one structured
 * passed / failed / inconclusive judgment per check over a bounded diff —
 * rubric judging of the same kind, on the same gateway.
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
 * Boundary-crossing triage (LUM-945) — after the rule detectors record a
 * crossing, this model reads the task context and returns P(legit). TypeSafe
 * Jev is an EVALUATION model (typed question → probability), not a language
 * model: it is called through `@/lib/ai/evaluation`, never `gateway(id)`.
 * Chosen on the LUM-945 offline comparison (372 human-labelled production
 * crossings; boolean question). Catalog 2026-10-03: its only endpoint has
 * `zdr: none` / `no_training: all` — the one model in this registry that is
 * not zero-data-retention (user ruling on LUM-945).
 */
export const CROSSING_TRIAGE_MODEL = 'typesafe-ai/jev'

/**
 * The embedding model id lives in `./embedding` (`EMBEDDING_MODEL`), coupled to
 * `EMBEDDING_DIM` and the pgvector column width. It is deliberately NOT
 * re-exported here: that module statically imports `@ai-sdk/gateway`, whereas
 * this registry stays a zero-runtime-dependency string module so any service
 * can import a model id without pulling the gateway (and its jest-hostile
 * TransformStream) into scope.
 */
