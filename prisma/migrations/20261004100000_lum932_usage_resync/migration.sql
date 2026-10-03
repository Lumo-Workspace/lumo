-- LUM-932 `lumo usage resync`: exact correction of historical (pre-CLI-1.85.0)
-- token usage. Additive only: one nullable column plus a new audit table.
ALTER TABLE "sessions" ADD COLUMN "usageResyncedAt" TIMESTAMP(3);

CREATE TABLE "usage_resync_audits" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "workspaceMemberId" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "factors" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_resync_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "usage_resync_audits_sessionId_idx" ON "usage_resync_audits"("sessionId");
CREATE INDEX "usage_resync_audits_workspaceId_idx" ON "usage_resync_audits"("workspaceId");

ALTER TABLE "usage_resync_audits" ADD CONSTRAINT "usage_resync_audits_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_resync_audits" ADD CONSTRAINT "usage_resync_audits_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
