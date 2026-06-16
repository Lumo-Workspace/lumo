-- LUM-530: deduplicate dropped_fragments + add the (sessionId, taskId,
-- fragmentType, fragmentId) unique constraint, mirroring lineage_edges
-- (20260606150000_lineage_edge_session_task_unique). The repository's
-- createMany now passes skipDuplicates, so a bound session re-recording the
-- same dropped fragments on every session-start is idempotent.
--
-- Table name follows the @@map snake_case convention (dropped_fragments);
-- columns are camelCase, mirroring 20260615150000_lineage_token_weights.

-- Dedup pre-existing duplicates BEFORE building the unique index, otherwise the
-- CREATE UNIQUE INDEX fails on historical rows (bound session-start has been
-- inserting duplicates since LUM-522 collection landed). Keep the lowest ctid
-- per group. Postgres treats NULL as distinct, so null-session rows can never
-- violate the index — restrict the dedup to non-null sessionId to avoid
-- collapsing rows the index would actually permit.
DELETE FROM "dropped_fragments" a
USING "dropped_fragments" b
WHERE a."sessionId" IS NOT NULL
  AND a."sessionId" = b."sessionId"
  AND a."taskId" = b."taskId"
  AND a."fragmentType" = b."fragmentType"
  AND a."fragmentId" = b."fragmentId"
  AND a.ctid > b.ctid;

-- CreateIndex
CREATE UNIQUE INDEX "dropped_fragments_sessionId_taskId_fragmentType_fragmentId_key" ON "dropped_fragments"("sessionId", "taskId", "fragmentType", "fragmentId");
