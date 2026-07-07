-- CreateTable
CREATE TABLE "idea_slack_contexts" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "permalink" TEXT NOT NULL,
    "slackTeamId" TEXT NOT NULL,
    "slackChannelId" TEXT NOT NULL,
    "slackChannelName" TEXT,
    "rootTs" TEXT NOT NULL,
    "threadTs" TEXT,
    "isThread" BOOLEAN NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "refreshError" TEXT,
    "summary" TEXT,
    "summaryGeneratedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_slack_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_web_links" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "note" TEXT,
    "imageUrl" TEXT,
    "faviconUrl" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "fetchError" TEXT,
    "body" TEXT,
    "bodyFetchedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_web_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_figma_links" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
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

    CONSTRAINT "idea_figma_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idea_slack_contexts_ideaId_idx" ON "idea_slack_contexts"("ideaId");

-- CreateIndex
CREATE INDEX "idea_slack_contexts_workspaceId_idx" ON "idea_slack_contexts"("workspaceId");

-- CreateIndex
CREATE INDEX "idea_web_links_ideaId_createdAt_idx" ON "idea_web_links"("ideaId", "createdAt");

-- CreateIndex
CREATE INDEX "idea_web_links_workspaceId_idx" ON "idea_web_links"("workspaceId");

-- CreateIndex
CREATE INDEX "idea_figma_links_ideaId_idx" ON "idea_figma_links"("ideaId");

-- CreateIndex
CREATE INDEX "idea_figma_links_workspaceId_idx" ON "idea_figma_links"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "idea_figma_links_ideaId_fileKey_nodeId_key" ON "idea_figma_links"("ideaId", "fileKey", "nodeId");

-- AddForeignKey
ALTER TABLE "idea_slack_contexts" ADD CONSTRAINT "idea_slack_contexts_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_slack_contexts" ADD CONSTRAINT "idea_slack_contexts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_slack_contexts" ADD CONSTRAINT "idea_slack_contexts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "workspace_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_web_links" ADD CONSTRAINT "idea_web_links_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_web_links" ADD CONSTRAINT "idea_web_links_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_web_links" ADD CONSTRAINT "idea_web_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "workspace_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_figma_links" ADD CONSTRAINT "idea_figma_links_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_figma_links" ADD CONSTRAINT "idea_figma_links_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_figma_links" ADD CONSTRAINT "idea_figma_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "workspace_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_figma_links" ADD CONSTRAINT "idea_figma_links_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "figma_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
