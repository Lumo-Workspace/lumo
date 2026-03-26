-- CreateTable
CREATE TABLE "github_integrations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "tokenType" TEXT NOT NULL DEFAULT 'oauth',
    "githubUserId" TEXT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "repositories" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "github_integrations_workspaceId_idx" ON "github_integrations"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "github_integrations_workspaceId_memberId_key" ON "github_integrations"("workspaceId", "memberId");

-- AddForeignKey
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
