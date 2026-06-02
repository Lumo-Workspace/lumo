-- AlterTable
ALTER TABLE "milestones" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "milestones_projectId_archivedAt_idx" ON "milestones"("projectId", "archivedAt");
