-- Per-workspace GitHub team App installation (team-level integration).
-- CreateTable
CREATE TABLE "github_app_installations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "installationId" INTEGER NOT NULL,
    "accountLogin" TEXT,
    "accountType" TEXT,
    "repositories" TEXT[],
    "installedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_app_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_app_installations_workspaceId_key" ON "github_app_installations"("workspaceId");

-- CreateIndex
CREATE INDEX "github_app_installations_installationId_idx" ON "github_app_installations"("installationId");

-- AddForeignKey
ALTER TABLE "github_app_installations" ADD CONSTRAINT "github_app_installations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_app_installations" ADD CONSTRAINT "github_app_installations_installedBy_fkey" FOREIGN KEY ("installedBy") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
