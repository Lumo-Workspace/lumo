# LUM-336 — Manual `memory add` reconcile + cross-language dedup

**Date:** 2026-06-09
**Milestone:** Memory v6 — Reconcile-on-Write & Lifecycle
**Status:** Design approved (brainstorming), pending spec review → implementation plan

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

### D. Data cleanup

Keep auto/EN, delete manual/ZH:

- DECISION: keep `cmq72c817` (auto/EN), delete `cmq72b0yy` (manual/ZH)
- TRAP: keep `cmq72c81k` (auto/EN), delete `cmq72b1us` (manual/ZH)

Before deleting: `lumo project memory list` to verify all 4 ids still exist,
match the expected scope/category, and haven't been mutated by another session;
surface the verification to the user and get explicit confirmation before any
delete. Confirm `lumo memory rm` semantics (invalidate vs hard-delete) first.

### E. Testing / workflow

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
  reusing its reconcile/apply functions.
- Re-calibrating the floor for cross-language is moot: canonicalization removes
  the cross-language case from the floor's job.

## Acceptance criteria (from task)

1. Manual `memory add` of a fact near-synonymous (incl. cross-language) with an
   existing memory → no second row.
2. Cross-language near-synonym dedup behavior has test coverage (eval slice with
   measured cosine + recommended handling).
3. The 2 existing LUM-327 duplicate pairs cleaned to 1 + 1.
4. No breakage to the existing reconcile-on-write path / triggers / lease /
   `status='ACTIVE'` filter.
5. Full jest + tsc green.
