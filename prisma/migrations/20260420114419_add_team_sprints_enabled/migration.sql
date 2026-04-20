-- AlterTable
ALTER TABLE "teams" ADD COLUMN "sprintsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any team that had a cadence configured was already opted-in to sprints.
UPDATE "teams" SET "sprintsEnabled" = true WHERE "sprintCadenceDays" IS NOT NULL;

-- Drop deprecated cadence/autoPrepare columns; manual create-with-dates supersedes them.
ALTER TABLE "teams" DROP COLUMN "sprintCadenceDays";
ALTER TABLE "teams" DROP COLUMN "sprintAutoPrepare";
