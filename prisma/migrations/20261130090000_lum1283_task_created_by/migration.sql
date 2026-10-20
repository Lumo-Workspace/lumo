-- LUM-1283: record the WorkspaceMember that created each task (a user, never
-- an agent). Additive only: one nullable column, its index and FK (ON DELETE
-- SET NULL), plus a one-time backfill. No row is deleted and no existing value
-- is overwritten.

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "createdByMemberId" TEXT;

-- CreateIndex
CREATE INDEX "tasks_createdByMemberId_idx" ON "tasks"("createdByMemberId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: the member behind the actor of the task's earliest TASK_CREATED
-- activity, when that actor is a member's actor and the member belongs to the
-- task's workspace. Tasks with no such activity (automation-created, activity
-- pruned) or whose earliest creator actor has no member (an agent) stay NULL.
UPDATE "tasks" AS t
SET "createdByMemberId" = wm."id"
FROM (
  SELECT DISTINCT ON (ta."taskId") ta."taskId", ta."actorId"
  FROM "task_activities" AS ta
  WHERE ta."type" = 'TASK_CREATED' AND ta."actorId" IS NOT NULL
  ORDER BY ta."taskId", ta."createdAt" ASC, ta."id" ASC
) AS src
JOIN "actors" AS a ON a."id" = src."actorId"
JOIN "workspace_members" AS wm ON wm."id" = a."memberId"
WHERE t."id" = src."taskId"
  AND wm."workspaceId" = t."workspaceId"
  AND t."createdByMemberId" IS NULL;
