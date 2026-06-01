-- CreateTable
CREATE TABLE "google_drive_integrations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "googleUserId" TEXT NOT NULL,
    "googleEmail" TEXT,
    "scopes" TEXT[],
    "needsReauth" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_drive_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "google_drive_integrations_workspaceId_idx" ON "google_drive_integrations"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "google_drive_integrations_workspaceId_memberId_key" ON "google_drive_integrations"("workspaceId", "memberId");

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "googleDocId" TEXT,
ADD COLUMN "googleDocImporterId" TEXT,
ADD COLUMN "googleDocSyncedAt" TIMESTAMP(3),
ADD COLUMN "googleDocSyncError" TEXT;

-- CreateIndex
CREATE INDEX "Document_workspaceId_googleDocId_idx" ON "Document"("workspaceId", "googleDocId");

-- AddForeignKey
ALTER TABLE "google_drive_integrations" ADD CONSTRAINT "google_drive_integrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_drive_integrations" ADD CONSTRAINT "google_drive_integrations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
