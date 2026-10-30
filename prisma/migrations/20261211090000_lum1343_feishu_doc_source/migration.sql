-- LUM-1343: Feishu / Lark doc import source on "Document". Additive only:
-- five nullable columns and one index. No existing row or column changes.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "feishuDocToken" TEXT,
ADD COLUMN "feishuSourceUrl" TEXT,
ADD COLUMN "feishuImporterId" TEXT,
ADD COLUMN "feishuSyncedAt" TIMESTAMP(3),
ADD COLUMN "feishuSyncError" TEXT;

-- CreateIndex
CREATE INDEX "Document_workspaceId_feishuDocToken_idx" ON "Document"("workspaceId", "feishuDocToken");
