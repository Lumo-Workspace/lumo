-- Add per-workspace `number` + derived `slug` columns to Document, plus the
-- `documentSeq` counter on Workspace that allocates them.
-- PR-1 of two-step rollout: columns stay nullable until PR-2 flips reads to
-- slug-only and adds NOT NULL. Backfill all existing rows here so unique
-- indexes can be created safely.

ALTER TABLE "Document" ADD COLUMN "number" INTEGER;
ALTER TABLE "Document" ADD COLUMN "slug" TEXT;
ALTER TABLE "workspaces" ADD COLUMN "documentSeq" INTEGER NOT NULL DEFAULT 0;

-- Assign sequential per-workspace numbers, oldest doc first.
WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "workspaceId"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "Document"
)
UPDATE "Document" d
SET "number" = numbered.rn
FROM numbered
WHERE d.id = numbered.id;

-- Compute slug as slugify(title)-number. Empty / non-ascii-only titles fall
-- back to "untitled". The `-<number>` suffix is appended unconditionally,
-- which guarantees per-workspace uniqueness without a collision loop.
WITH base_calc AS (
  SELECT
    id,
    trim(both '-' from regexp_replace(
      lower(coalesce(nullif(title, ''), 'untitled')),
      '[^a-z0-9]+', '-', 'g'
    )) AS base
  FROM "Document"
)
UPDATE "Document" d
SET slug = (CASE WHEN bc.base = '' THEN 'untitled' ELSE bc.base END)
        || '-' || d."number"::text
FROM base_calc bc
WHERE d.id = bc.id AND d."number" IS NOT NULL;

CREATE UNIQUE INDEX "Document_workspaceId_number_key" ON "Document"("workspaceId", "number");
CREATE UNIQUE INDEX "Document_workspaceId_slug_key" ON "Document"("workspaceId", "slug");

-- Initialise documentSeq per workspace to the highest backfilled number so
-- the first post-migration insert allocates max(number)+1 without colliding.
UPDATE "workspaces" w
SET "documentSeq" = COALESCE(sub.max_n, 0)
FROM (
  SELECT "workspaceId", MAX("number") AS max_n
  FROM "Document"
  WHERE "number" IS NOT NULL
  GROUP BY "workspaceId"
) sub
WHERE w.id = sub."workspaceId";
