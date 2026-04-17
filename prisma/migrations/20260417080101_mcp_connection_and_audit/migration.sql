-- CreateTable
CREATE TABLE "McpConnection" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "activeWorkspaceId" TEXT,
    "clientName" TEXT,
    "clientId" TEXT,
    "autoBoundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "McpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpAuditLog" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "McpConnection_clerkUserId_idx" ON "McpConnection"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "McpConnection_clerkUserId_clientId_key" ON "McpConnection"("clerkUserId", "clientId");

-- CreateIndex
CREATE INDEX "McpAuditLog_connectionId_createdAt_idx" ON "McpAuditLog"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "McpAuditLog_workspaceId_createdAt_idx" ON "McpAuditLog"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "McpConnection" ADD CONSTRAINT "McpConnection_activeWorkspaceId_fkey" FOREIGN KEY ("activeWorkspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
