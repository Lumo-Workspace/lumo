-- AlterTable
ALTER TABLE "github_integrations" ADD COLUMN     "webhookSecret" TEXT;

-- CreateTable
CREATE TABLE "github_webhooks" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "githubHookId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pull_requests" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT,
    "integrationId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "authorLogin" TEXT NOT NULL,
    "headBranch" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "ciStatus" TEXT,
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "github_webhooks_repo_idx" ON "github_webhooks"("repo");

-- CreateIndex
CREATE UNIQUE INDEX "github_webhooks_integrationId_repo_key" ON "github_webhooks"("integrationId", "repo");

-- CreateIndex
CREATE INDEX "pull_requests_workspaceId_idx" ON "pull_requests"("workspaceId");

-- CreateIndex
CREATE INDEX "pull_requests_taskId_idx" ON "pull_requests"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_repo_number_key" ON "pull_requests"("repo", "number");

-- AddForeignKey
ALTER TABLE "github_webhooks" ADD CONSTRAINT "github_webhooks_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "github_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "github_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
