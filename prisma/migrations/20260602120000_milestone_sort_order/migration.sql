-- AlterTable
ALTER TABLE "milestones" ADD COLUMN "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "milestones_projectId_sortOrder_idx" ON "milestones"("projectId", "sortOrder");

-- Backfill existing milestones so the manual order initially matches the old
-- targetDate (nulls last) -> createdAt ordering. No visible change on deploy.
UPDATE "milestones" m
SET "sortOrder" = sub.rn
FROM (
  SELECT id,
         (ROW_NUMBER() OVER (
            PARTITION BY "projectId"
            ORDER BY "targetDate" ASC NULLS LAST, "createdAt" ASC
          ) - 1)::double precision AS rn
  FROM "milestones"
) sub
WHERE m.id = sub.id;
