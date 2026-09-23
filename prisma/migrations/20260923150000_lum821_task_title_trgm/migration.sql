-- LUM-821 fuzzy task search (`lumo task search`, typo-tolerant + ranked)
--
-- Purely additive: enables the pg_trgm extension and adds one GIN trigram
-- index on tasks.title. No DROP, no backfill, no column change.
--
-- The index serves both `title ILIKE '%term%'` and the `term <<% title`
-- strict word-similarity operator the search query uses. It is built without
-- CONCURRENTLY (migrations run in a transaction), which briefly blocks
-- writes to "tasks" while it builds — the table is small enough that this is
-- sub-second.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "tasks_title_trgm_idx"
  ON "tasks" USING GIN ("title" gin_trgm_ops);
