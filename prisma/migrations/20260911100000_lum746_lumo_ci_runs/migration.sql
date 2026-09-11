-- LUM-746 (Lumo-managed CI): additive only — one new table, no existing
-- table or row touched. One row per (pull request, head sha) managed CI run.
CREATE TABLE "lumo_ci_runs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "headSha" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "runId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "lumo_ci_runs_pkey" PRIMARY KEY ("id")
);

-- "same sha runs once"
CREATE UNIQUE INDEX "lumo_ci_runs_pullRequestId_headSha_key" ON "lumo_ci_runs"("pullRequestId", "headSha");

-- per-workspace hourly cap count
CREATE INDEX "lumo_ci_runs_workspaceId_startedAt_idx" ON "lumo_ci_runs"("workspaceId", "startedAt");

CREATE INDEX "lumo_ci_runs_taskId_idx" ON "lumo_ci_runs"("taskId");

ALTER TABLE "lumo_ci_runs" ADD CONSTRAINT "lumo_ci_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lumo_ci_runs" ADD CONSTRAINT "lumo_ci_runs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lumo_ci_runs" ADD CONSTRAINT "lumo_ci_runs_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
