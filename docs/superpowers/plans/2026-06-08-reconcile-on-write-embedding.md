# LUM-324 (cont.) — Semantic Embedding Retrieval (pgvector) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. This plan EXTENDS the merged-ish #426 reconcile-on-write work on the same branch `lumo/LUM-324-reconcile-on-write`; it does NOT replace it.

**Goal:** Swap the lexical bigram neighbor retriever for a semantic embedding retriever (Mem0-faithful vector store): store per-memory embeddings in pgvector, retrieve top-k by cosine distance, keep the lexical retriever as fallback.

**Architecture:** Embeddings generated via Vercel AI Gateway model `alibaba/qwen3-embedding-0.6b` (1024-dim) over the existing `memoryContentToText` flattening. Stored in a pgvector `vector(1024)` column on `memories`. Retrieval and embedding-writes use parameterized raw SQL confined to the repository layer (the unavoidable pgvector exception to the "never raw SQL" rule). `EmbeddingNeighborRetriever` (async, DB-backed) composes over `lexicalNeighborRetriever` as fallback. Zero behavior change when embeddings are absent (falls back to #426 lexical).

**Tech stack:** Prisma (postgresql/Neon) with `Unsupported("vector(1024)")` column + raw SQL, `@ai-sdk/gateway` + `ai` `embedMany`, pgvector hnsw cosine index, Jest. Worktree-isolated; tests run from inside the worktree.

---

## Decisions (locked)
- Embedding model: `alibaba/qwen3-embedding-0.6b`, **1024-dim** → `vector(1024)`.
- Storage/retrieval: **pgvector + raw SQL** DB-side top-k (user choice over `Float[]`+in-app).
- Scope: folded into LUM-324, same branch / PR #426.
- Fallback: `lexicalNeighborRetriever` (from #426) retained; used whenever embeddings are unavailable (no key, null embedding, gateway error).
- **Raw SQL is confined to `lib/repositories/memory.repository.ts`**, parameterized (`$queryRaw`/`$executeRaw` with tagged-template params — never string interpolation), documented as the deliberate pgvector exception.

## Hard prerequisites / heads-ups
- **`AI_GATEWAY_API_KEY` must be in the main checkout `.env.local`** for live/end-to-end verification (Tasks 7–8). Tasks 1–6 are mock-testable without it. Do NOT mark the work done until live embedding generation + retrieval is verified with the key present.
- **pgvector extension** must exist on the DB. Dev: this plan's migration runs `CREATE EXTENSION IF NOT EXISTS vector`. **Prod: requires the extension enabled + `prisma migrate deploy` on deploy — do NOT apply to prod manually; call it out in the PR.**
- Worktree migration gotchas (see project memory): the datasource URL comes from `prisma.config.ts`; `db execute` rejects `--schema`/`--url`; export the main `.env.local` `DATABASE_URL_UNPOOLED` first; prefer the offline `migrate diff --from-schema` SQL path to bypass dev drift; never `migrate reset`.
- Prisma's typed client CANNOT read or write the `Unsupported("vector")` column — all embedding I/O is raw SQL in the repository.

## File map

**New**
- `lib/ai/embedding.ts` — gateway embedding wrapper (`embedMemoryText`, `embedMany`), DIP boundary.
- `lib/services/memory/embedding-neighbor-retriever.ts` — `EmbeddingNeighborRetriever` (async, repo-backed) + `compositeNeighborRetriever` (embedding → lexical fallback).
- `prisma/migrations/<ts>_add_memory_embedding/migration.sql` — extension + column + index.
- `scripts/backfill-memory-embeddings.ts` — one-time backfill of existing rows.

**Modified**
- `prisma/schema.prisma` — `embedding Unsupported("vector(1024)")?` on `Memory`; enable `postgresqlExtensions` preview + `extensions = [vector]` on the datasource.
- `lib/repositories/memory.repository.ts` — `findNeighborEmbeddings(...)` (raw `$queryRaw` cosine top-k, scoped) + `setEmbedding(id, vector, tx)` (raw `$executeRaw`); `create`/`supersedeInPlace`/`updateContent` callers stamp embeddings via the new write method.
- `lib/services/memory/neighbor-retriever.ts` — make `NeighborRetriever.retrieve` **async** (returns `Promise<ScoredNeighbor[]>`); `lexicalNeighborRetriever` becomes async (trivially).
- `lib/services/memory/layer1-apply.ts` / `layer2-apply.ts` — pre-compute embeddings (outside tx, parallel) for ADD/UPDATE/SUPERSEDE; stamp inside the tx.
- `lib/services/memory/layer1.service.ts` / `layer2.service.ts` — embed each candidate query, `await` retrieve; inject `compositeNeighborRetriever`.
- `app/api/memories/[memoryId]/route.ts` (PATCH) + CLI `memory add` server path — stamp embedding on manual writes (or accept null + rely on backfill; see Task 7).

---

## Task 1: Schema — pgvector column + extension + index

**Files:** `prisma/schema.prisma`, new `prisma/migrations/<ts>_add_memory_embedding/migration.sql`

- [ ] **Step 1:** In `schema.prisma`, on the `datasource db` block add `extensions = [vector]`, and in `generator client` add `previewFeatures = ["postgresqlExtensions"]` (merge with any existing preview features). On `model Memory` add:
```prisma
  /// 1024-dim embedding of memoryContentToText(content). Written/read via raw SQL
  /// only — Prisma's typed client can't touch Unsupported columns. LUM-324.
  embedding Unsupported("vector(1024)")?
```
- [ ] **Step 2:** Hand-write `prisma/migrations/<timestamp>_add_memory_embedding/migration.sql`. **NO HNSW index** (review point D): at Lumo's scale — hundreds of memories/project, low thousands total — an exact `ORDER BY embedding <=> $1 LIMIT k` seq scan is fast AND exact, whereas HNSW is *approximate* ANN that would contaminate the LUM-329 recall@k baseline. Add an index only when row counts reach tens of thousands.
```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "memories" ADD COLUMN "embedding" vector(1024);
```
- [ ] **Step 3:** Do NOT apply to the dev DB or run `prisma generate` in this task. The `Unsupported("vector")` column is never referenced by the typed client (all embedding I/O is raw SQL), so Tasks 2–6 tsc-pass and unit-test without the column physically existing. **The dev-DB apply + `prisma generate` + `migrate status` are deferred to Task 8** (bundled with the live key-gated verification) to avoid touching the shared dev DB / shared prisma client mid-stream (parallel worktrees). Just commit `schema.prisma` + `migration.sql`.
- [ ] **Step 4:** `npx tsc --noEmit` clean (schema change alone doesn't break typed code). Commit schema + migration SQL.

> Deferring the dev-apply keeps every key-independent task green without racing the shared prisma client; the migration is exercised against the real DB once, in Task 8.

## Task 2: Embedding wrapper `lib/ai/embedding.ts`

**Files:** create `lib/ai/embedding.ts`; test `__tests__/lib/ai/embedding.test.ts`

- [ ] **Step 1 (failing test):** mock `ai`'s `embedMany` + `@ai-sdk/gateway`; assert `embedTexts(['a','b'])` calls the model `alibaba/qwen3-embedding-0.6b` and returns the vectors; assert it returns `[]` (or throws a typed error the caller catches) on gateway failure. Assert `EMBEDDING_DIM === 1024`.
- [ ] **Step 2:** Implement:
```ts
import { embedMany } from 'ai'
import { gateway } from '@ai-sdk/gateway'

export const EMBEDDING_MODEL = 'alibaba/qwen3-embedding-0.6b'
export const EMBEDDING_DIM = 1024

/** Embed N texts in one call. Throws on failure — callers decide fallback. */
export async function embedTexts(values: string[]): Promise<number[][]> {
  if (values.length === 0) return []
  const { embeddings } = await embedMany({
    model: gateway.textEmbeddingModel(EMBEDDING_MODEL),
    values,
  })
  return embeddings
}
```
(Confirm the exact AI-SDK embedding entrypoint at implement time — `gateway.textEmbeddingModel(id)` vs `gateway(id)`; the test mocks whichever is used. Keep the model id + dim as exported constants.)
- [ ] **Step 3:** Run test → pass. Commit.

## Task 3: Repository — raw-SQL embedding read + write

**Files:** `lib/repositories/memory.repository.ts`; test `__tests__/memory.repository.embedding.test.ts`

- [ ] **Step 1 (failing test):** mock the prisma client's `$queryRaw` / `$executeRaw`. Assert:
  - `setEmbedding(id, vector, tx?)` issues a parameterized `$executeRaw` `UPDATE "memories" SET "embedding" = $1::vector WHERE "id" = $2` with the vector serialized as a pgvector literal (`[v1,v2,...]`).
  - `findNeighborEmbeddings({ scope, queryVector, k })` issues a parameterized `$queryRaw` ordering by `"embedding" <=> $queryVector::vector`, filters `"embedding" IS NOT NULL` and the right scope (`taskId=$` for TASK; `projectId=$ AND scope='PROJECT'` for PROJECT). **NO category filter** (review point E): lexical fallback ranks across categories (same-category is only a ranking boost there), so the embedding corpus must also be cross-category — scope must mirror `findActiveTaskMemories(taskId)` / `findActiveProjectMemories(projectId)` *exactly* so "embedding on" and "lexical fallback" search the SAME candidate set. `LIMIT k`. Maps rows to `{ id, category, content, score }` where **score = `1 - cosine_distance`** (so higher = closer; documented).
  - **Returns `{ neighbors, scopeHasEmbeddings }`** (review point B): `scopeHasEmbeddings` = a cheap `EXISTS(SELECT 1 FROM memories WHERE <scope> AND embedding IS NOT NULL)`. Lets the composite retriever tell "scope not yet backfilled (all NULL)" apart from "scope embedded but no neighbor above floor" — closing the backfill-window duplicate-explosion gap without operational gating.
- [ ] **Step 2:** Implement both methods with **tagged-template `Prisma.sql` parameters only** (never interpolate the vector or ids into the string). Serialize the vector as a pgvector text literal `[a,b,c]` bound as a single `$n::vector` param. Scope is a discriminated `{ kind:'TASK', taskId } | { kind:'PROJECT', projectId }` mapped to the WHERE clause. Add a top-of-method comment: deliberate pgvector raw-SQL exception to CLAUDE.md, confined to this repository.
- [ ] **Step 3:** Run test → pass. `npx tsc --noEmit`. Commit.

> Note: these are unit tests over the query-construction (mocked client), not a live DB. Live retrieval is exercised in Task 8.

## Task 4: `NeighborRetriever` → async + `EmbeddingNeighborRetriever` + composite fallback

**Files:** modify `lib/services/memory/neighbor-retriever.ts` (async interface); new `lib/services/memory/embedding-neighbor-retriever.ts`; tests.

- [ ] **Step 1:** Make `NeighborRetriever.retrieve` return `Promise<ScoredNeighbor[]>`. Update `lexicalNeighborRetriever.retrieve` to `async` (body unchanged; it just becomes awaitable). Update the #426 retriever test to `await`. Run → green.
- [ ] **Step 2 (failing tests — use SYNTHETIC 1024-d vectors with known cosine order, review de-risk):** check in a small fixture of hand-built vectors (e.g. one-hot / orthogonal + near-duplicates) whose pairwise cosine order is known by construction, so the floor/ordering/fallback logic is verified by MATH now, without a key or live DB. Assert:
  - `EmbeddingNeighborRetriever`: given a query vector + scope, calls `memoryRepository.findNeighborEmbeddings` and returns rows with `score ≥ EMBEDDING_SCORE_FLOOR`, dropping those below; ordering by score desc preserved.
  - `EMBEDDING_SCORE_FLOOR` is a distinct constant (NOT the lexical 0.3).
  - `compositeNeighborRetriever` fallback predicate (review point B): falls back to `lexicalNeighborRetriever` when **`query.vector` is absent OR the embedding retriever throws OR `scopeHasEmbeddings === false`**; does NOT fall back when `scopeHasEmbeddings === true` and the (above-floor) neighbor list is simply empty (genuine no-neighbor → empty result, candidate becomes ADD). Mock the repo (return `{neighbors, scopeHasEmbeddings}`) + lexical.
- [ ] **Step 3:** Implement.
  - `EMBEDDING_SCORE_FLOOR` (review point A): cosine-similarity baseline for unrelated sentence embeddings runs high (~0.3–0.5), so the lexical 0.3 floor would admit noise. Default **0.6**, marked `// placeholder — calibrate via LUM-329 eval`. `score = 1 - cosine_distance`.
  - `NeighborQuery = { category, text, vector?: number[] }` (lexical needs `text`, embedding needs `vector`). One call shape `RetrieveContext = { query, pool, scope, k }` (`pool` for lexical, `scope` discriminated TASK/PROJECT for the embedding DB query).
  - `EmbeddingNeighborRetriever.retrieve(ctx)`: requires `ctx.query.vector`; calls `findNeighborEmbeddings({scope, queryVector, k})`; applies `EMBEDDING_SCORE_FLOOR`; returns `{ neighbors, scopeHasEmbeddings }` upward (or the composite reads it).
  - `compositeNeighborRetriever.retrieve(ctx)`: if `!ctx.query.vector` → lexical. Else `try { const r = await embedding.retrieve(ctx); if (!r.scopeHasEmbeddings) return lexical.retrieve(ctx); return r.neighbors } catch { return lexical.retrieve(ctx) }`.
- [ ] **Step 4:** Run → green. tsc. Commit.

> `RetrieveContext = { query:{category,text,vector?}, pool, scope, k }` is the single call shape. Corpus parity (review point E): the embedding `scope` MUST select the same candidate set as the lexical `pool` (TASK→same-task memories, PROJECT→project PROJECT memories, cross-category) — add an explicit test/comment asserting this so fallback is a transparent degrade, not a corpus switch.

## Task 5: Write-path embedding stamping (apply, both layers)

**Files:** `lib/services/memory/layer1-apply.ts`, `layer2-apply.ts`; extend their tests.

- [ ] **Step 1 (failing test):** assert that for ADD/UPDATE/SUPERSEDE ops, apply (a) computes an embedding from the validated content via `embedTexts([memoryContentToText(cat, content)])` BEFORE opening the transaction, and (b) inside the tx calls `memoryRepository.setEmbedding(id, vector, tx)` after the content write. Assert that when `embedTexts` throws, the content write still succeeds and embedding is simply skipped (embedding is best-effort; backfill/next-write will fill it). Mock `embedTexts` + repo.
- [ ] **Step 2:** Restructure apply: collect the ops needing embeddings. For each, **reuse a caller-supplied vector when present** (review point C — the service passes the candidate vector it already computed for retrieval; reuse for ADD when content deep-equals the candidate); otherwise `embedTexts(...)` the remaining ops' `memoryContentToText(content)` once (batched) outside the tx. Map vectors back to ops, then in each plan write content (existing path) + `setEmbedding`. For ADD, the row id isn't known until create returns — call `setEmbedding(created.id, vec, tx)` after create. Wrap the embed call in try/catch → on failure, proceed without embedding (best-effort; log warn; backfill/next-write fills it). Keep the atomic content transaction intact.
- [ ] **Step 3:** Run → green. tsc. Commit.

## Task 6: Service wiring — embed query + async retrieve (both layers)

**Files:** `lib/services/memory/layer1.service.ts`, `layer2.service.ts`; extend tests.

- [ ] **Step 1 (failing test):** assert the service embeds each candidate's text (`embedTexts`) and passes the vector into the composite retriever, and `await`s retrieval; assert fallback to lexical when `embedTexts` throws (retrieval still returns, no throw — fire-and-forget contract preserved). Mock `embedTexts` + retriever.
- [ ] **Step 2:** Swap the injected `retriever` to `compositeNeighborRetriever`. Before retrieval, batch-embed all candidate texts ONCE (`embedTexts(candidates.map(c => memoryContentToText(c.category, c.content)))`) — keep this `candidateVectors` array. Per candidate build `{ query: { category, text, vector }, pool: existingMemories, scope, k }` and `await retriever.retrieve(...)`. On embed failure (whole batch throws), pass `vector: undefined` for all → composite uses lexical. L2 scope = `{ kind:'PROJECT', projectId }`; L1 scope = `{ kind:'TASK', taskId }`.
  - **Reuse the candidate vector at write time (review point C):** pass `candidateVectors` (aligned to candidates) into `applyLayer{1,2}Operations` so the apply step can REUSE a candidate's already-computed vector instead of re-embedding. For an **ADD** op whose `content` deep-equals the originating candidate's `content`, reuse that candidate's vector (no second `embedTexts` call). For UPDATE/SUPERSEDE (final content may differ from the candidate) and for ADD with mutated content, apply re-embeds (Task 5). Thread a `candidateVectorByContentKey` map (or pass `{op, vector?}` pairs) so apply can look up the reusable vector.
- [ ] **Step 3:** Run → green. tsc. Full memory suite green. Commit.

## Task 7: Manual write paths (PATCH route + CLI add) + backfill script

**Files:** `app/api/memories/[memoryId]/route.ts`, the server handler behind `lumo memory add`, `scripts/backfill-memory-embeddings.ts`; tests where they exist.

- [ ] **Step 1:** For manual create/edit (PATCH route + CLI add service), stamp embedding best-effort using the same `embedTexts` + `setEmbedding` pattern (or explicitly leave null and rely on backfill — pick one; if leaving null, log it). Add/adjust tests to assert the stamping call (mocked).
- [ ] **Step 2:** `scripts/backfill-memory-embeddings.ts`: page over `memories` where `embedding IS NULL` (raw count + ids via repo), `embedTexts` in batches, `setEmbedding` each. Idempotent, resumable, rate-limited. Dry-run flag. Document run instructions in the PR (operational, run once after deploy + extension enabled).
- [ ] **Step 3:** tsc + targeted tests green. Commit.

## Task 8: Live verification (requires `AI_GATEWAY_API_KEY`) + full sweep + PR update

**Files:** none (verification + docs).

- [ ] **Step 1:** Confirm `AI_GATEWAY_API_KEY` present in main `.env.local`. If absent, STOP and report — live verification can't proceed; everything above is mock-tested only.
- [ ] **Step 2:** Live smoke: a small node script (or a gated test) that embeds two semantically-near, lexically-far memory texts (e.g. "API call missing memberId filter" vs "user endpoint needs workspace scoping"), writes them, and asserts the embedding retriever ranks them as neighbors where lexical would not. This is the payoff proof — capture the output.
- [ ] **Step 3:** `npx tsc --noEmit` clean; full `npx jest` green; `npx prisma migrate status` clean on dev.
- [ ] **Step 4:** Run the backfill against dev; verify counts.
- [ ] **Step 5:** Update PR #426: note the schema change (pgvector `vector(1024)`, extension, hnsw index), the new gateway embedding dependency (model `alibaba/qwen3-embedding-0.6b`), the deliberate raw-SQL pgvector exception (repo-confined), **prod requirements** (enable `vector` extension + `migrate deploy` + run backfill once), and the lexical fallback. Keep task in_review.

---

## Self-review notes (author)
- **Spec coverage:** embedding store (Task 1) ✓; gateway generation reusing memoryContentToText (Task 2/5) ✓; pgvector raw-SQL read+write confined to repo (Task 3) ✓; async retriever + lexical fallback (Task 4) ✓; write stamping both layers + manual paths (Task 5/7) ✓; service async wiring (Task 6) ✓; backfill (Task 7) ✓; live verification gated on key (Task 8) ✓.
- **Non-breaking:** when embeddings absent/failed, composite → lexical = #426 behavior. Fire-and-forget + lease + triggers unchanged. The `Unsupported` column doesn't break the typed client.
- **Type consistency:** `NeighborQuery` gains optional `vector`; `RetrieveContext = {query,pool,scope,k}` is the single call shape; `EMBEDDING_DIM=1024` matches `vector(1024)`.
- **Open risk:** exact AI-SDK embedding entrypoint for the gateway (`textEmbeddingModel`) + whether the gateway exposes `alibaba/qwen3-embedding-0.6b` — confirmed live in Task 8; if the id/dim differs, adjust the migration + constant (re-migrate is cheap in dev).
