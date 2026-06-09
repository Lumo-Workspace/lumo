# LUM-336 — Manual `memory add` reconcile + cross-language dedup

**Date:** 2026-06-09
**Milestone:** Memory v6 — Reconcile-on-Write & Lifecycle
**Status:** Design approved → implemented; **amended mid-implementation by measurement (see Update below)**

## Update (measured, 2026-06-09) — root cause (b) did not hold

The cross-language eval slice (§C) was run live (qwen3-embedding-0.6b). Result for
5 faithful ZH↔EN synonym pairs: **raw cross-language cosine mean = 0.886, min =
0.821, below-0.78-floor = 0/5.** qwen3 is strongly multilingual-aligned, so ZH↔EN
synonyms sit *above* the `EMBEDDING_SCORE_FLOOR = 0.78`.

Consequences (this reverses the design's premise):

1. **Root cause (b) — "cross-language floor misconfig" — is not supported by data.**
   Cross-language dedup already works at the embedding layer. A new English manual
   add retrieves an existing Chinese row (cosine ~0.886 > floor) — so the C2
   "existing-corpus backfill" is also unnecessary for dedup.
2. **English-canonicalization is therefore a CONVENTION, not a dedup fix** (user
   decision: keep a single-language store for human readability/consistency, and
   so the flywheel doesn't split one fact across two language variants). It is no
   longer justified by the dedup argument.
3. **Dropped from scope:** the §D existing-corpus backfill (was Task 9b) — dedup
   doesn't need it; existing-row language normalization is a deferred *optional*
   convention follow-up, not part of this change.
4. Same-language LUM-329 calibration is preserved (floor 0.78, F1 0.611, recall@1
   0.718, n=39) — the xlang cases are excluded from the AR sweep and reported
   separately.

Net: root cause **(a)** (manual add bypasses reconcile) is the real, dedup-relevant
fix; **(b)** is reframed — canonicalization stays as a workspace convention. The
sections below are the as-designed text; read them through this Update.

## Problem

Two orthogonal, code-confirmed defects let duplicate PROJECT/TASK memories
accumulate:

- **(a) Manual `memory add` bypasses reconcile.** `createForProject` /
  `createForTask` in `lib/services/memory-management.service.ts` are bare
  `memoryRepository.create()` + best-effort embedding — no neighbor retrieval,
  no reconcile, no SUPERSEDE-or-skip. Human-entered memory never reconciles
  against what already exists. (The auto Stop-hook / consolidation path
  `layer1.service.ts` / `layer2.service.ts` *does* the full retrieve → reconcile
  → apply.)
- **(b) Cross-language floor misconfiguration.** `EMBEDDING_SCORE_FLOOR = 0.78`
  (`embedding-neighbor-retriever.ts`) was calibrated by LUM-329 on a
  **same-language (English) n=39 corpus**. Lumo's store is bilingual (English
  auto-sediment + Chinese manual). A ZH↔EN synonym pair's cosine sits below the
  floor, so even when the auto reconcile path *does* run it cannot recognize the
  cross-language duplicate.

Live evidence: 2 duplicate PROJECT pairs exist right now (a DECISION pair and a
TRAP pair), each = one auto/EN row + one manual/ZH row of the same fact. Every
session's Stop-hook auto-EN sediment keeps minting new cross-language dups
against existing Chinese rows — this grows unbounded if unfixed.

## Decisions (locked during brainstorming)

1. **Dedup granularity = hybrid gating.** Retrieve neighbors first; only invoke
   the reconcile LLM when a near-duplicate neighbor exists, else plain ADD.
2. **Canonical language = English, normalized on write.** Manual writes
   translate non-English content to English before storing. The store becomes
   uniformly English, so dedup degrades to same-language and the existing 0.78
   floor works as calibrated. This supersedes the original "measure-then-pick
   ①/②/③" plan — strategy ① (canonical-language embedding) is chosen, with the
   canonical language fixed to English.
3. **Reconcile + translation model = `deepseek/deepseek-v4-flash`** (same model
   the auto reconcile path uses).
4. **Data cleanup keeps the English copy.** Of each duplicate pair, keep
   auto/EN, delete manual/ZH.
5. **No schema change.** The 4-category prose schema is untouched (LUM-327 is
   closed); no knowledge graph.

## Design

### A. Canonicalize-to-English on write

New helper `canonicalizeToEnglish(category, content)`:

- **Dynamic-import** the gateway (`@ai-sdk/gateway` static import crashes jest
  via TransformStream — established trap; the auto path's judge already
  dynamic-imports for the same reason).
- One `generateObject` call (deepseek-v4-flash) that translates each
  natural-language **string field** of the structured `MemoryContent` to
  English while **preserving the per-category schema shape and keys**. If the
  content is already English, return it unchanged.
- Validate the output through `parseMemoryContent(category, …)`.
- **fail-open:** no key / gateway failure / validation failure → return the
  ORIGINAL content unchanged and proceed with the write. A manual add must never
  be lost or blocked by a translation failure.

**Applies to every human-content write path** (to honor "default to English"
consistently): `createForProject`, `createForTask`, `editContent`, and
`promoteToProject` (only when a `content` override is provided). Cost: English
input → zero translation calls; non-English input → one translation call per
write.

### B. Hybrid-gated dedup (create paths only)

In `createForProject` / `createForTask`, after canonicalization:

1. Compute candidate text + best-effort embedding (reuse the existing
   `embedTexts` already imported by the service — no new gateway coupling for
   this step).
2. Retrieve neighbors via `compositeNeighborRetriever` (embedding → lexical
   fallback), scope = PROJECT/TASK, k = `NEIGHBOR_K`. The retriever needs an
   in-memory `pool` (lexical path) and `scope` (embedding path) — assemble the
   pool from `memoryRepository.listForProject` / `listForTask` (ACTIVE rows
   only, mirroring the auto path's input).
3. **Gate:** no neighbor clears the floor → original `memoryRepository.create()`
   (behavior unchanged, zero LLM).
4. Near-duplicate neighbor present → **dynamic-import** `reconcileLayer2Candidates`
   (PROJECT) / `reconcileLayer1Candidates` (TASK) with the single known
   candidate + its neighbors → `ADD / UPDATE / SUPERSEDE / NOOP` → route to the
   matching apply (`applyLayer2Operations` / `applyLayer1Operations`, or a thin
   single-op application). Reuse `reconcile-parse` (LUM-335), already inside both
   reconcile functions.
5. **fail-open:** reconcile failure / no key → plain ADD.

`editContent` / `promoteToProject` do **not** dedup (they mutate an existing
row; deduping a row against the store is meaningless / could self-supersede) —
they only canonicalize.

**CLI feedback:** when dedup resolves to a non-ADD, the service returns enough
for the CLI to print the outcome explicitly (e.g. "merged into existing memory
cmxxx / skipped, no new row") rather than silently. Return-shape note: the
existing API route expects the created row; the reconcile branch may yield
UPDATE/NOOP/SUPERSEDE — the service returns a discriminated result the route +
CLI render. Exact shape is pinned in the implementation plan.

### C. Cross-language eval slice (LUM-329 harness)

- Add ZH↔EN synonym pairs to `scripts/eval/memory/eval-set.ts` (Chinese
  translations of existing English cases), labeled `DUPLICATE→NOOP` /
  `REFINEMENT→UPDATE`, validated by the existing `validateEvalCase` contract.
- `fixture-gen.ts` re-embeds (key in `.env.local`; fixture is 7.4MB and already
  in `.prettierignore`).
- `run.ts` adds a **cross-lingual cosine** report: **raw ZH↔EN cosine (low —
  documents *why* canonicalization is needed) vs canonicalized-to-English cosine
  (high — clears the 0.78 floor)**. This before/after is the empirical evidence
  that strategy ① works, satisfying acceptance criterion #2.
- Key-gated live run; no key → skip (not a failure), per LUM-329 convention.

### D. Existing-corpus canonicalization backfill (REQUIRED — closes C2)

Canonicalize-on-write only fixes *future* writes. The store is currently a
**mixed embedding space**: auto/EN rows embedded from English text, manual/ZH
rows embedded from Chinese text. A new English candidate's query vector is
compared (`embedding <=> queryVector` in `findNeighborEmbeddings`) against those
stored vectors — so it scores a low cross-language cosine against the existing
Chinese rows, falls below the floor, and **is not retrieved**. Result: a manual
add still duplicates an existing non-English row. This breaks acceptance #1 for
the existing corpus and is independent of the EN-vs-ZH choice — any canonical
language needs it.

**Fix:** a one-time, idempotent, resumable backfill (`scripts/backfill-memory-canonicalize.ts`,
modeled on `scripts/backfill-memory-embeddings.ts` — same DI-testable core +
keyset-by-id loop). For each ACTIVE row whose flattened content contains CJK:
translate to English (`canonicalizeToEnglish`), `updateContent` **in place**
(stable id — preserves lineage edges / usage votes / provenance; this is a
representation normalization, not a semantic supersede), and re-embed. Rows that
fail translation (fail-open returns original / still CJK) are skipped and retried
on the next run. Already-English rows are skipped. Run `--dry-run` first for a
count; then the live run (key-gated, prod via `.env.production`).

Scope bound (YAGNI): the backfill puts the whole store in one embedding space so
future manual adds dedup correctly; it does **not** run a historical dedup sweep
over latent existing duplicates (not in acceptance) — the two known LUM-327 pairs
are handled by the explicit cleanup below.

### E. Data cleanup

Keep auto/EN, delete manual/ZH (consistent with canonical=English):

- DECISION: keep `cmq72c817` (auto/EN), delete `cmq72b0yy` (manual/ZH)
- TRAP: keep `cmq72c81k` (auto/EN), delete `cmq72b1us` (manual/ZH)

Run AFTER the canonicalization backfill (don't waste a translation on rows about
to be deleted). Before deleting: `lumo project memory list` to verify all 4 ids
still exist, match the expected scope/category, and haven't been mutated by
another session; surface the verification to the user and get explicit
confirmation before any delete. Confirm `lumo memory rm` semantics (invalidate
vs hard-delete) first.

### F. Testing / workflow

- Isolated worktree (done) + TDD + subagent execution.
- Coverage:
  - canonicalization: English input returned unchanged; Chinese input → English
    (mock LLM); fail-open returns original on gateway error.
  - gating: no neighbor → ADD (behavior-unchanged regression); near-duplicate
    neighbor → NOOP/skip (no second row); reconcile failure → fail-open ADD.
  - cross-language eval slice (live, key-gated; skip without key).
  - post-cleanup list shows 1 + 1.
- Full jest across BOTH test roots (`__tests__/` and `tests/`) + `tsc --noEmit`
  green. All gateway usage via dynamic import to keep jest's module graph clean.
- No schema change. PR title `[LUM-336]`; description notes no migration needed
  and the new (transitive) gateway/translation calls on the manual write path.

## Out of scope / non-goals

- No change to the 4-category prose schema (LUM-327 closed).
- No knowledge graph.
- No change to the auto Stop-hook / Layer-2 consolidation pipeline beyond
  reusing its reconcile/apply functions. (The auto extraction prompt already
  emits English, so it needs no change to honor canonical=English.)
- Re-calibrating the floor for cross-language is moot: canonicalization removes
  the cross-language case from the floor's job.
- No historical dedup sweep over latent existing duplicates beyond the two known
  LUM-327 pairs (§E). The §D backfill only normalizes the embedding space.
- Canonical language is fixed to English for this workspace (user decision,
  aligned with the English-emitting auto path); making it a per-workspace
  setting is a future generalization, not built now.

## Acceptance criteria (from task)

1. Manual `memory add` of a fact near-synonymous (incl. cross-language) with an
   existing memory → no second row.
2. Cross-language near-synonym dedup behavior has test coverage (eval slice with
   measured cosine + recommended handling).
3. The 2 existing LUM-327 duplicate pairs cleaned to 1 + 1.
4. No breakage to the existing reconcile-on-write path / triggers / lease /
   `status='ACTIVE'` filter.
5. Full jest + tsc green.
