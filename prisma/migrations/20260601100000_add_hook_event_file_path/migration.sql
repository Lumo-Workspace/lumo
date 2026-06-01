-- AlterTable
ALTER TABLE "hook_events" ADD COLUMN "filePath" TEXT;

-- CreateIndex
CREATE INDEX "hook_events_workspaceId_filePath_createdAt_idx" ON "hook_events"("workspaceId", "filePath", "createdAt");
