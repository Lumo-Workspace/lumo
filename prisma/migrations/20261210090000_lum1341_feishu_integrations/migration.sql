-- LUM-1341: Feishu / Lark connection. Additive only: two new tables, no
-- change to existing rows.

-- CreateTable
CREATE TABLE "feishu_integrations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "installedBy" TEXT,
    "domain" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "tenantAccessToken" TEXT,
    "tenantTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feishu_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feishu_account_integrations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "name" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "needsReauth" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feishu_account_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feishu_integrations_workspaceId_key" ON "feishu_integrations"("workspaceId");

-- CreateIndex
CREATE INDEX "feishu_integrations_tenantKey_idx" ON "feishu_integrations"("tenantKey");

-- CreateIndex
CREATE INDEX "feishu_account_integrations_workspaceId_idx" ON "feishu_account_integrations"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "feishu_account_integrations_workspaceId_memberId_key" ON "feishu_account_integrations"("workspaceId", "memberId");

-- AddForeignKey
ALTER TABLE "feishu_integrations" ADD CONSTRAINT "feishu_integrations_installedBy_fkey" FOREIGN KEY ("installedBy") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feishu_integrations" ADD CONSTRAINT "feishu_integrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feishu_account_integrations" ADD CONSTRAINT "feishu_account_integrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feishu_account_integrations" ADD CONSTRAINT "feishu_account_integrations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
