-- LUM-745 (managed-scan ops): additive only.
-- One nullable column (the workflow run id stage A started) and one index for
-- the per-workspace hourly cap count.
ALTER TABLE "pr_security_scans" ADD COLUMN "managedRunId" TEXT;
CREATE INDEX "pr_security_scans_workspaceId_startedAt_idx" ON "pr_security_scans"("workspaceId", "startedAt");
