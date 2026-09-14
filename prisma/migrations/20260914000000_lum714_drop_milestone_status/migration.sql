-- LUM-714: collapse milestone state to active/archived.
--
-- The MilestoneStatus enum (PLANNED/ACTIVE/COMPLETED/CANCELLED) is removed.
-- "Completed" stops being a stored state and becomes derived from task
-- completion, materialized only as `completedAt`; `archivedAt` stays the one
-- explicit human state.
--
-- DESTRUCTIVE: drops `milestones.status` and the MilestoneStatus type. The two
-- backfills below preserve the meaning of the terminal values before the drop —
-- everything else (PLANNED vs ACTIVE) was derivable from task counts and needs
-- no carry-over.

-- 1. COMPLETED milestones that never got a completedAt stamp (pre-LUM-624 rows,
--    or rows completed by a path that only wrote status) keep their completion.
--    `updatedAt` is the closest recorded instant for when that happened.
UPDATE "milestones"
SET "completedAt" = "updatedAt"
WHERE "status" = 'COMPLETED' AND "completedAt" IS NULL;

-- 2. CANCELLED is a "dropped, not delivered" terminal choice with no successor
--    field. Archiving preserves that intent: without this, every cancelled
--    milestone would silently reappear in the default (active) list.
UPDATE "milestones"
SET "archivedAt" = "updatedAt"
WHERE "status" = 'CANCELLED' AND "archivedAt" IS NULL;

-- 3. Drop the column, its index, and the now-unreferenced enum type.
DROP INDEX IF EXISTS "milestones_projectId_status_idx";

ALTER TABLE "milestones" DROP COLUMN "status";

DROP TYPE "MilestoneStatus";

-- 4. Replace the dropped composite index with the one the new read paths use:
--    the changelog baseline scans a project's completed milestones.
CREATE INDEX "milestones_projectId_completedAt_idx" ON "milestones"("projectId", "completedAt");
