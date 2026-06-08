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
- [ ] **Step 2:** Hand-write `prisma/migrations/<timestamp>_add_memory_embedding/migration.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "memories" ADD COLUMN "embedding" vector(1024);
CREATE INDEX "memories_embedding_hnsw_idx" ON "memories"
  USING hnsw ("embedding" vector_cosine_ops);
```
- [ ] **Step 3:** Apply to dev via the offline path (export `DATABASE_URL_UNPOOLED` from main `.env.local` first): `npx prisma db execute --file prisma/migrations/<ts>_add_memory_embedding/migration.sql`, then `npx prisma migrate resolve --applied <ts>_add_memory_embedding`, then `npx prisma generate`.
- [ ] **Step 4:** Verify: `npx prisma migrate status` clean; `npx tsc --noEmit` clean (the `Unsupported` column generates no typed field, so no client breakage). Commit schema + migration.

> Verification of the column existing is structural (migrate status + a `\d memories` style check via `db execute`); no jest here.

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
  - `findNeighborEmbeddings({ scope:'TASK', taskId, category?, queryVector, k })` issues a parameterized `$queryRaw` ordering by `"embedding" <=> $queryVector::vector`, filters `"embedding" IS NOT NULL` and the right scope (`taskId=$` for TASK; `projectId=$ AND scope='PROJECT'` for PROJECT), `LIMIT k`, and maps rows to `{ id, category, content, score }` (score = `1 - distance` or the raw distance — pick one and document; tests assert the mapping shape).
- [ ] **Step 2:** Implement both methods with **tagged-template `Prisma.sql` parameters only** (never interpolate the vector or ids into the string). Serialize the vector as a pgvector text literal `[a,b,c]` bound as a single `$n::vector` param. Add a top-of-method comment: deliberate pgvector raw-SQL exception to CLAUDE.md.
- [ ] **Step 3:** Run test → pass. `npx tsc --noEmit`. Commit.

> Note: these are unit tests over the query-construction (mocked client), not a live DB. Live retrieval is exercised in Task 8.

## Task 4: `NeighborRetriever` → async + `EmbeddingNeighborRetriever` + composite fallback

**Files:** modify `lib/services/memory/neighbor-retriever.ts` (async interface); new `lib/services/memory/embedding-neighbor-retriever.ts`; tests.

- [ ] **Step 1:** Make `NeighborRetriever.retrieve` return `Promise<ScoredNeighbor[]>`. Update `lexicalNeighborRetriever.retrieve` to `async` (body unchanged; it just becomes awaitable). Update the #426 retriever test to `await`. Run → green.
- [ ] **Step 2 (failing test):** for `EmbeddingNeighborRetriever`: given a query embedding + scope, it calls `memoryRepository.findNeighborEmbeddings` and returns its rows. For `compositeNeighborRetriever`: when the embedding retriever returns results, use them; when it throws or returns empty AND the query has no embedding (or repo signals unavailable), fall back to `lexicalNeighborRetriever`. Mock the repo + lexical.
- [ ] **Step 3:** Implement. `EmbeddingNeighborRetriever.retrieve(query, scope, k)` takes a `queryVector` (the service embeds the candidate text and passes it in) — i.e. the interface for the embedding path is `{ category, text, vector }`. Design the query type so lexical (needs `text`) and embedding (needs `vector`) both fit: `NeighborQuery = { category, text, vector?: number[] }`. Composite: if `query.vector` present → try embedding retriever (catch → lexical); else → lexical. Pool is still passed for lexical fallback; embedding path ignores pool (DB-backed) and uses `scope`.
- [ ] **Step 4:** Run → green. tsc. Commit.

> The retriever signature reshapes to carry both `pool` (lexical) and `scope` (embedding DB query). Define `RetrieveContext = { query, pool, scope, k }` to keep one clean call shape. Document it.

## Task 5: Write-path embedding stamping (apply, both layers)

**Files:** `lib/services/memory/layer1-apply.ts`, `layer2-apply.ts`; extend their tests.

- [ ] **Step 1 (failing test):** assert that for ADD/UPDATE/SUPERSEDE ops, apply (a) computes an embedding from the validated content via `embedTexts([memoryContentToText(cat, content)])` BEFORE opening the transaction, and (b) inside the tx calls `memoryRepository.setEmbedding(id, vector, tx)` after the content write. Assert that when `embedTexts` throws, the content write still succeeds and embedding is simply skipped (embedding is best-effort; backfill/next-write will fill it). Mock `embedTexts` + repo.
- [ ] **Step 2:** Restructure apply: collect the ops needing embeddings, `embedTexts(...)` once (batched) outside the tx, map vectors back to ops, then in each plan write content (existing path) + `setEmbedding`. For ADD, the row id isn't known until create returns — call `setEmbedding(created.id, vec, tx)` after create. Wrap the embed call in try/catch → on failure, proceed without embedding (log warn). Keep the atomic content transaction intact.
- [ ] **Step 3:** Run → green. tsc. Commit.

## Task 6: Service wiring — embed query + async retrieve (both layers)

**Files:** `lib/services/memory/layer1.service.ts`, `layer2.service.ts`; extend tests.

- [ ] **Step 1 (failing test):** assert the service embeds each candidate's text (`embedTexts`) and passes the vector into the composite retriever, and `await`s retrieval; assert fallback to lexical when `embedTexts` throws (retrieval still returns, no throw — fire-and-forget contract preserved). Mock `embedTexts` + retriever.
- [ ] **Step 2:** Swap the injected `retriever` to `compositeNeighborRetriever`. Before retrieval, batch-embed all candidate texts (`embedTexts(candidates.map(...))`); per candidate build `{ query: { category, text, vector }, pool: existingMemories, scope, k }` and `await retriever.retrieve(...)`. On embed failure, pass `vector: undefined` → composite uses lexical. L2 scope = `{ kind:'PROJECT', projectId }`; L1 scope = `{ kind:'TASK', taskId }`.
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
