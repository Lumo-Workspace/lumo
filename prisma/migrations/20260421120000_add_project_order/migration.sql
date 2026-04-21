-- Add order column to projects with safe default.
ALTER TABLE "projects" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

-- Backfill order per workspace by name ascending so existing lists render in
-- the previous alphabetical order the moment the app starts sorting by it.
UPDATE "projects" p
SET "order" = t.rn
FROM (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "workspaceId" ORDER BY name ASC) AS rn
  FROM "projects"
) t
WHERE p.id = t.id;

-- Index to speed up per-workspace ordered listing.
CREATE INDEX "projects_workspaceId_order_idx" ON "projects" ("workspaceId", "order");
