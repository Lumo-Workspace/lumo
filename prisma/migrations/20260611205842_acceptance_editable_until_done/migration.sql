-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "workStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "acceptance_criteria" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "acceptance_criteria_taskId_deletedAt_idx" ON "acceptance_criteria"("taskId", "deletedAt");
