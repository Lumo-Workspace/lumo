-- LUM-1059: human-readable boundary-crossing refs (`<TEAM>-X<n>`).
-- Additive: two nullable columns on boundary_crossings, a per-workspace
-- counter on workspaces, a backfill of existing rows, a unique index.
-- Nothing is deleted or rewritten besides filling the new columns.

ALTER TABLE "workspaces" ADD COLUMN "crossingSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "boundary_crossings" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "boundary_crossings" ADD COLUMN "number" INTEGER;

-- Workspace: the task's, else the steward milestone's project's.
UPDATE "boundary_crossings" bc
SET "workspaceId" = t."workspaceId"
FROM "tasks" t
WHERE bc."taskId" = t."id";

UPDATE "boundary_crossings" bc
SET "workspaceId" = p."workspaceId"
FROM "milestones" m
JOIN "projects" p ON p."id" = m."projectId"
WHERE bc."workspaceId" IS NULL AND bc."milestoneId" = m."id";

-- Number existing rows per workspace in detection order.
WITH numbered AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "workspaceId" ORDER BY "detectedAt" ASC, "id" ASC
         ) AS rn
  FROM "boundary_crossings"
  WHERE "workspaceId" IS NOT NULL
)
UPDATE "boundary_crossings" bc
SET "number" = numbered.rn
FROM numbered
WHERE bc."id" = numbered."id";

-- Seed the counter so the next crossing continues after the backfill.
UPDATE "workspaces" w
SET "crossingSeq" = mx.max_number
FROM (
  SELECT "workspaceId", MAX("number") AS max_number
  FROM "boundary_crossings"
  WHERE "workspaceId" IS NOT NULL
  GROUP BY "workspaceId"
) mx
WHERE w."id" = mx."workspaceId";

CREATE UNIQUE INDEX "boundary_crossings_workspaceId_number_key"
  ON "boundary_crossings"("workspaceId", "number");
