-- LUM-1282: factual terminal timestamps. Additive only: two nullable columns.
ALTER TABLE "tasks" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "canceledAt" TIMESTAMP(3);

-- Data step: backfill completedAt for tasks already DONE, from the latest
-- STATUS_CHANGED -> DONE activity, falling back to updatedAt when the task has
-- no such activity (created DONE, or older than the activity log). Only rows
-- still NULL are touched, so re-running is a no-op. No row is CANCELED yet
-- (the value is new), so canceledAt needs no backfill.
UPDATE "tasks" AS t
SET "completedAt" = COALESCE(
  (
    SELECT MAX(a."createdAt")
    FROM "task_activities" AS a
    WHERE a."taskId" = t."id"
      AND a."type" = 'STATUS_CHANGED'
      AND a."payload"->>'to' = 'DONE'
  ),
  t."updatedAt"
)
WHERE t."status" = 'DONE'
  AND t."completedAt" IS NULL;
