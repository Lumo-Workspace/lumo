-- LUM-324: semantic embedding for reconcile-on-write neighbor retrieval.
-- pgvector column on memories, written/read only via parameterized raw SQL
-- (Prisma's typed client can't touch the vector type). Model
-- alibaba/qwen3-embedding-0.6b → 1024 dimensions.
--
-- No ANN index on purpose: at Lumo's scale (hundreds of memories per project,
-- low thousands total) an exact `ORDER BY embedding <=> $1 LIMIT k` sequential
-- scan is fast AND exact. HNSW is approximate and would contaminate the
-- LUM-329 recall@k baseline. Add an index only once row counts reach tens of
-- thousands.
--
-- PROD: requires the `vector` extension enabled and `prisma migrate deploy`
-- on the next deploy, plus a one-time embedding backfill of existing rows.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "memories" ADD COLUMN "embedding" vector(1024);
