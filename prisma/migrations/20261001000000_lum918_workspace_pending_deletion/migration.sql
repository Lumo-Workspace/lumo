-- LUM-918: 48-hour undo window for workspace deletion (additive only).

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN "deletionExecuteAt" TIMESTAMP(3),
ADD COLUMN "deletionRequestedByClerkId" TEXT;

-- CreateIndex
CREATE INDEX "workspaces_deletionExecuteAt_idx" ON "workspaces"("deletionExecuteAt");
