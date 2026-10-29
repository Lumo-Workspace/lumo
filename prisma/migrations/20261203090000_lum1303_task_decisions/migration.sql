-- LUM-1303: task decisions get their own table (shown on the task's Decisions
-- tab) instead of a `## Decisions` section in the description.
--
-- Additive: a new table only. Existing description sections are moved into it
-- by the one-time backfill (scripts/backfill-task-decisions.ts), which also
-- strips the section from each description.

CREATE TABLE "task_decisions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rationale" TEXT,
    "createdById" TEXT,
    "sourceSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_decisions_taskId_createdAt_idx" ON "task_decisions"("taskId", "createdAt");
CREATE INDEX "task_decisions_workspaceId_idx" ON "task_decisions"("workspaceId");
CREATE INDEX "task_decisions_createdById_idx" ON "task_decisions"("createdById");

ALTER TABLE "task_decisions" ADD CONSTRAINT "task_decisions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_decisions" ADD CONSTRAINT "task_decisions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_decisions" ADD CONSTRAINT "task_decisions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
