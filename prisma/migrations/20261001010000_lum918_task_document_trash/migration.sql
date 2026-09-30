-- LUM-918: 30-day trash for tasks and documents (additive only).

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "trashRootId" TEXT,
ADD COLUMN "deletedByClerkId" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "trashRootId" TEXT,
ADD COLUMN "deletedByClerkId" TEXT;

-- CreateIndex
CREATE INDEX "tasks_deletedAt_idx" ON "tasks"("deletedAt");

-- CreateIndex
CREATE INDEX "tasks_trashRootId_idx" ON "tasks"("trashRootId");

-- CreateIndex
CREATE INDEX "Document_deletedAt_idx" ON "Document"("deletedAt");

-- CreateIndex
CREATE INDEX "Document_trashRootId_idx" ON "Document"("trashRootId");
