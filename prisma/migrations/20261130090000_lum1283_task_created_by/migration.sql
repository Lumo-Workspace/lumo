-- LUM-1283: record the Actor that created each task. Additive only: one
-- nullable column, its index and FK (ON DELETE SET NULL), plus a one-time
-- backfill. No row is deleted and no existing value is overwritten.

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "createdByActorId" TEXT;

-- CreateIndex
CREATE INDEX "tasks_createdByActorId_idx" ON "tasks"("createdByActorId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdByActorId_fkey" FOREIGN KEY ("createdByActorId") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: the actor of the task's earliest TASK_CREATED activity, when that
-- activity has an actor and the actor belongs to the task's workspace. Tasks
-- with no such activity (automation-created, or activity pruned) stay NULL.
UPDATE "tasks" AS t
SET "createdByActorId" = src."actorId"
FROM (
  SELECT DISTINCT ON (ta."taskId") ta."taskId", ta."actorId"
  FROM "task_activities" AS ta
  WHERE ta."type" = 'TASK_CREATED' AND ta."actorId" IS NOT NULL
  ORDER BY ta."taskId", ta."createdAt" ASC, ta."id" ASC
) AS src
JOIN "actors" AS a ON a."id" = src."actorId"
WHERE t."id" = src."taskId"
  AND a."workspaceId" = t."workspaceId"
  AND t."createdByActorId" IS NULL;
