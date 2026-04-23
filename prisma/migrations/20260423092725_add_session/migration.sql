-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workspaceMemberId" TEXT NOT NULL,
    "cwd" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_workspaceId_lastActivityAt_idx" ON "sessions"("workspaceId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "sessions_workspaceMemberId_lastActivityAt_idx" ON "sessions"("workspaceMemberId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "hook_events_sessionId_createdAt_idx" ON "hook_events"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "hook_events" ADD CONSTRAINT "hook_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspaceMemberId_fkey" FOREIGN KEY ("workspaceMemberId") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
