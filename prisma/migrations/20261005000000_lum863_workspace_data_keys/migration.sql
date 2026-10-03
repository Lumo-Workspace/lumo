-- LUM-863: application-layer envelope encryption, first applied to
-- HookEvent.payload. Additive only: two new nullable HookEvent columns, the
-- payload column relaxed to nullable (encrypted rows leave it NULL), and the
-- per-workspace data-key table. No existing row is read or rewritten.

-- AlterTable
ALTER TABLE "hook_events" ADD COLUMN     "payloadEncrypted" TEXT,
ADD COLUMN     "toolUseId" TEXT,
ALTER COLUMN "payload" DROP NOT NULL;

-- CreateTable
CREATE TABLE "workspace_data_keys" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kekId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_data_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_data_keys_workspaceId_version_key" ON "workspace_data_keys"("workspaceId", "version");

-- AddForeignKey
ALTER TABLE "workspace_data_keys" ADD CONSTRAINT "workspace_data_keys_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

