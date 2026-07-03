-- LUM-640: STEWARD (governance) session role — purely additive.
-- Session gains role (default IMPLEMENTATION) + nullable milestoneId;
-- BoundaryCrossing gains nullable milestoneId (and taskId relaxes to nullable
-- so a milestone-scoped steward crossing has somewhere to live);
-- VerificationRun gains a FK-less sourceSessionId provenance pointer.
-- No DROP TABLE / DROP COLUMN / DROP INDEX; no data migration.

-- CreateEnum
CREATE TYPE "SessionRole" AS ENUM ('IMPLEMENTATION', 'STEWARD');

-- AlterEnum
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'STEWARD_IMPLEMENTATION_ARTIFACT';

-- AlterTable: sessions
ALTER TABLE "sessions" ADD COLUMN "role" "SessionRole" NOT NULL DEFAULT 'IMPLEMENTATION';
ALTER TABLE "sessions" ADD COLUMN "milestoneId" TEXT;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "sessions_milestoneId_idx" ON "sessions"("milestoneId");

-- AlterTable: boundary_crossings (taskId → nullable; existing rows untouched)
ALTER TABLE "boundary_crossings" ALTER COLUMN "taskId" DROP NOT NULL;
ALTER TABLE "boundary_crossings" ADD COLUMN "milestoneId" TEXT;

-- AddForeignKey
ALTER TABLE "boundary_crossings" ADD CONSTRAINT "boundary_crossings_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "boundary_crossings_milestoneId_category_target_idx" ON "boundary_crossings"("milestoneId", "category", "target");

-- AlterTable: verification_runs (FK-less audit pointer, mirrors outcome_signals.sessionId)
ALTER TABLE "verification_runs" ADD COLUMN "sourceSessionId" TEXT;
