-- CreateTable
CREATE TABLE "figma_integrations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "figmaUserId" TEXT NOT NULL,
    "figmaHandle" TEXT NOT NULL,
    "figmaEmail" TEXT,
    "scopes" TEXT[],
    "needsReauth" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "figma_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_figma_links" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "integrationId" TEXT,
    "url" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "frameName" TEXT,
    "thumbnailUrl" TEXT,
    "thumbnailFetchedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_figma_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "figma_integrations_workspaceId_idx" ON "figma_integrations"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "figma_integrations_workspaceId_memberId_key" ON "figma_integrations"("workspaceId", "memberId");

-- CreateIndex
CREATE INDEX "task_figma_links_taskId_idx" ON "task_figma_links"("taskId");

-- CreateIndex
CREATE INDEX "task_figma_links_workspaceId_idx" ON "task_figma_links"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "task_figma_links_taskId_fileKey_nodeId_key" ON "task_figma_links"("taskId", "fileKey", "nodeId");

-- AddForeignKey
ALTER TABLE "figma_integrations" ADD CONSTRAINT "figma_integrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "figma_integrations" ADD CONSTRAINT "figma_integrations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_figma_links" ADD CONSTRAINT "task_figma_links_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_figma_links" ADD CONSTRAINT "task_figma_links_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_figma_links" ADD CONSTRAINT "task_figma_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "workspace_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_figma_links" ADD CONSTRAINT "task_figma_links_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "figma_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
