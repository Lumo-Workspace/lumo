-- AlterEnum
ALTER TYPE "TaskActivityType" ADD VALUE 'SENTRY_ALERT';

-- CreateTable
CREATE TABLE "sentry_integrations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "installedBy" TEXT,
    "orgSlug" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "lastWebhookAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sentry_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentry_project_mappings" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sentryProjectSlug" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sentry_project_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentry_issue_links" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sentryIssueId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sentry_issue_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sentry_integrations_workspaceId_key" ON "sentry_integrations"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "sentry_integrations_orgSlug_key" ON "sentry_integrations"("orgSlug");

-- CreateIndex
CREATE INDEX "sentry_integrations_orgSlug_idx" ON "sentry_integrations"("orgSlug");

-- CreateIndex
CREATE INDEX "sentry_project_mappings_integrationId_idx" ON "sentry_project_mappings"("integrationId");

-- CreateIndex
CREATE INDEX "sentry_project_mappings_projectId_idx" ON "sentry_project_mappings"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "sentry_project_mappings_integrationId_sentryProjectSlug_key" ON "sentry_project_mappings"("integrationId", "sentryProjectSlug");

-- CreateIndex
CREATE INDEX "sentry_issue_links_taskId_idx" ON "sentry_issue_links"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "sentry_issue_links_integrationId_sentryIssueId_key" ON "sentry_issue_links"("integrationId", "sentryIssueId");

-- AddForeignKey
ALTER TABLE "sentry_integrations" ADD CONSTRAINT "sentry_integrations_installedBy_fkey" FOREIGN KEY ("installedBy") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentry_integrations" ADD CONSTRAINT "sentry_integrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentry_project_mappings" ADD CONSTRAINT "sentry_project_mappings_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "sentry_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentry_project_mappings" ADD CONSTRAINT "sentry_project_mappings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentry_issue_links" ADD CONSTRAINT "sentry_issue_links_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "sentry_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentry_issue_links" ADD CONSTRAINT "sentry_issue_links_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
