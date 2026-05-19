-- Backfill: indexes that were declared in prisma/schema.prisma but never made
-- it into a migration. Surfaced by `prisma migrate dev` when adding the
-- task_slack_contexts table.

-- CreateIndex
CREATE INDEX "tasks_projectId_status_idx" ON "tasks"("projectId", "status");

-- CreateIndex
CREATE INDEX "tasks_teamId_status_idx" ON "tasks"("teamId", "status");
