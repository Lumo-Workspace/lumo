-- CreateTable
CREATE TABLE "slack_integrations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "installedBy" TEXT,
    "accessToken" TEXT NOT NULL,
    "slackTeamId" TEXT NOT NULL,
    "slackTeamName" TEXT NOT NULL,
    "slackUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_channels" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "events" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slack_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slack_integrations_workspaceId_key" ON "slack_integrations"("workspaceId");

-- CreateIndex
CREATE INDEX "slack_integrations_slackTeamId_idx" ON "slack_integrations"("slackTeamId");

-- CreateIndex
CREATE INDEX "slack_channels_integrationId_idx" ON "slack_channels"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "slack_channels_integrationId_channelId_key" ON "slack_channels"("integrationId", "channelId");

-- AddForeignKey
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_installedBy_fkey" FOREIGN KEY ("installedBy") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_channels" ADD CONSTRAINT "slack_channels_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "slack_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
