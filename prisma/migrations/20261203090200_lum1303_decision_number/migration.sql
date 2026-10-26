-- LUM-1303: stable per-task decision numbers ("Decision 3") and a tombstone
-- so a deleted decision's number is never handed out again.
--
-- Rows that already exist (dev only — the table has not shipped) are numbered
-- per task in the order they were recorded. No data is deleted.

ALTER TABLE "task_decisions" ADD COLUMN "number" INTEGER;
ALTER TABLE "task_decisions" ADD COLUMN "deletedAt" TIMESTAMP(3);

UPDATE "task_decisions" AS d
SET "number" = n.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "taskId" ORDER BY "createdAt", "id") AS rn
  FROM "task_decisions"
) AS n
WHERE d."id" = n."id";

ALTER TABLE "task_decisions" ALTER COLUMN "number" SET NOT NULL;

CREATE UNIQUE INDEX "task_decisions_taskId_number_key" ON "task_decisions"("taskId", "number");
