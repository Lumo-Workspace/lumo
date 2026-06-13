-- LUM-477: coalesce repeated OPEN boundary crossings with the same
-- (taskId, category, target) into a single row. Additive, observe-only:
-- legacy rows get target=NULL (never coalesce) and occurrenceCount=1.

ALTER TABLE "boundary_crossings" ADD COLUMN IF NOT EXISTS "target" TEXT;
ALTER TABLE "boundary_crossings" ADD COLUMN IF NOT EXISTS "occurrenceCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "boundary_crossings" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);

-- Supports the open-crossing coalescing lookup (taskId, category, target).
CREATE INDEX IF NOT EXISTS "boundary_crossings_taskId_category_target_idx" ON "boundary_crossings"("taskId", "category", "target");
