-- LUM-643: milestone-level exit criteria + close-gate override trail.
-- New MilestoneExitVerdict enum + milestone_exit_criteria table (the close
-- contract, adjudicated rather than machine-verified) and three nullable
-- override-trail columns on milestones stamped when a human force-closes past
-- unresolved exit criteria. Purely additive DDL; nothing destructive, no data
-- migration.

-- CreateEnum
CREATE TYPE "MilestoneExitVerdict" AS ENUM ('MET', 'NOT_MET');

-- AlterTable: milestones (human close-gate override trail)
ALTER TABLE "milestones" ADD COLUMN "completedOverrideAt" TIMESTAMP(3);
ALTER TABLE "milestones" ADD COLUMN "completedOverrideByMemberId" TEXT;
ALTER TABLE "milestones" ADD COLUMN "completedOverrideNote" TEXT;

-- CreateTable
CREATE TABLE "milestone_exit_criteria" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "referentKind" "ReferentKind" NOT NULL,
    "source" "AcceptanceCriterionSource" NOT NULL,
    "sourceSessionId" TEXT,
    "verdict" "MilestoneExitVerdict",
    "verdictNote" TEXT,
    "verdictEvidence" TEXT,
    "verdictByMemberId" TEXT,
    "verdictSessionId" TEXT,
    "verdictAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "milestone_exit_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestone_exit_criteria_milestoneId_idx" ON "milestone_exit_criteria"("milestoneId");
CREATE INDEX "milestone_exit_criteria_milestoneId_deletedAt_idx" ON "milestone_exit_criteria"("milestoneId", "deletedAt");

-- AddForeignKey
ALTER TABLE "milestone_exit_criteria" ADD CONSTRAINT "milestone_exit_criteria_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
