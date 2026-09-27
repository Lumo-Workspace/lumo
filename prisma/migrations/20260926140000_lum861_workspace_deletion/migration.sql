-- LUM-861: deleting a workspace must remove all of its data.
-- 1. Document / DocumentRevision referenced workspaces with ON DELETE RESTRICT,
--    so deleting any workspace that owned a document failed with a FK error.
--    Re-create both constraints with ON DELETE CASCADE (constraint swap only;
--    no rows or columns are touched).
-- 2. New FK-less table for deletion receipts (DPA deletion evidence).

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentRevision" DROP CONSTRAINT "DocumentRevision_workspaceId_fkey";

-- CreateTable
CREATE TABLE "workspace_deletion_receipts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedByClerkId" TEXT NOT NULL,
    "rowCounts" JSONB NOT NULL,
    "blobCleanup" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_deletion_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_deletion_receipts_workspaceId_idx" ON "workspace_deletion_receipts"("workspaceId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
