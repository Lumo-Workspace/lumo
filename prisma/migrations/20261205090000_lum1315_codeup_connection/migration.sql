-- LUM-1315: Codeup as a second Git provider (dogfood). Additive only.
--
-- 1. `provider` ('github' | 'codeup', default 'github') on the three tables
--    that name a repository by its path, and in their unique keys: a Codeup
--    path can equal a GitHub `owner/repo`. Every existing row is GitHub, so
--    the new keys hold for existing data; they are created before the old
--    ones are dropped so uniqueness is enforced throughout.
-- 2. The workspace's Codeup connection (encrypted personal access token) and
--    the repositories it confirmed (per-repository webhook token hash).

-- AlterTable
ALTER TABLE "project_repositories" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'github';

-- AlterTable
ALTER TABLE "pull_requests" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'github';

-- AlterTable
ALTER TABLE "task_branches" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'github';

-- CreateIndex
CREATE UNIQUE INDEX "project_repositories_projectId_provider_fullName_key" ON "project_repositories"("projectId", "provider", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_workspaceId_provider_repo_number_key" ON "pull_requests"("workspaceId", "provider", "repo", "number");

-- CreateIndex
CREATE UNIQUE INDEX "task_branches_taskId_provider_repo_branchName_key" ON "task_branches"("taskId", "provider", "repo", "branchName");

-- DropIndex
DROP INDEX "project_repositories_projectId_fullName_key";

-- DropIndex
DROP INDEX "pull_requests_workspaceId_repo_number_key";

-- DropIndex
DROP INDEX "task_branches_taskId_repo_branchName_key";

-- CreateTable
CREATE TABLE "codeup_connections" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "connectedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "codeup_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codeup_repositories" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "repositoryId" INTEGER NOT NULL,
    "pathWithNamespace" TEXT NOT NULL,
    "webUrl" TEXT NOT NULL,
    "webhookId" INTEGER,
    "webhookTokenHash" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "codeup_repositories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "codeup_connections_workspaceId_key" ON "codeup_connections"("workspaceId");

-- CreateIndex
CREATE INDEX "codeup_connections_organizationId_idx" ON "codeup_connections"("organizationId");

-- CreateIndex
CREATE INDEX "codeup_repositories_repositoryId_idx" ON "codeup_repositories"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "codeup_repositories_connectionId_repositoryId_key" ON "codeup_repositories"("connectionId", "repositoryId");

-- AddForeignKey
ALTER TABLE "codeup_connections" ADD CONSTRAINT "codeup_connections_connectedBy_fkey" FOREIGN KEY ("connectedBy") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codeup_connections" ADD CONSTRAINT "codeup_connections_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codeup_repositories" ADD CONSTRAINT "codeup_repositories_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "codeup_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
