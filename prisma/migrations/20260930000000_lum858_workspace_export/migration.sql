-- LUM-858: GDPR workspace data export requests (additive only).

-- CreateEnum
CREATE TYPE "WorkspaceExportStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "workspace_exports" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedByClerkId" TEXT NOT NULL,
    "status" "WorkspaceExportStatus" NOT NULL DEFAULT 'PENDING',
    "blobUrl" TEXT,
    "sizeBytes" INTEGER,
    "rowCounts" JSONB,
    "error" TEXT,
    "workflowRunId" TEXT,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadedAt" TIMESTAMP(3),
    "lastDownloadedByClerkId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_exports_workspaceId_createdAt_idx" ON "workspace_exports"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "workspace_exports" ADD CONSTRAINT "workspace_exports_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
