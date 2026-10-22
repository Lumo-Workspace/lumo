-- LUM-1286 step 2: semantic embedding of each task title, for duplicate-check
-- candidate recall (`lumo task create`). Same model and width as
-- memories.embedding (alibaba/qwen3-embedding-0.6b, 1024 dims), read/written
-- only via parameterized raw SQL in task.repository.ts.
--
-- Additive and nullable: no data is changed or deleted. Rows stay NULL until
-- stamped on create/rename or by the one-time backfill
-- (scripts/backfill-task-title-embeddings.ts); a NULL row is simply not a
-- candidate. No ANN index: queries filter by "projectId" first and then do an
-- exact `ORDER BY "titleEmbedding" <=> $1 LIMIT k` over one project's tasks.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "tasks" ADD COLUMN "titleEmbedding" vector(1024);
