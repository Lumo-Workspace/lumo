-- PR-2 of the Document.slug rollout: enforce NOT NULL on `number` and `slug`,
-- after a defensive backfill pass that handles any rows created between the
-- PR-1 migration and the PR-1 code deploy (where the old code didn't write
-- the new columns).
--
-- Idempotent against the 0-NULL state — the WHERE clauses no-op when there's
-- nothing to backfill.

-- Defensive backfill: assign numbers continuing from each workspace's current
-- documentSeq, ordered by createdAt asc, id asc.
WITH null_rows AS (
  SELECT
    id,
    "workspaceId",
    title,
    ROW_NUMBER() OVER (
      PARTITION BY "workspaceId"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "Document"
  WHERE "number" IS NULL
),
workspace_seq AS (
  SELECT id, "documentSeq"
  FROM "workspaces"
)
UPDATE "Document" d
SET "number" = ws."documentSeq" + nr.rn
FROM null_rows nr
JOIN workspace_seq ws ON ws.id = nr."workspaceId"
WHERE d.id = nr.id;

-- Backfill slug for rows whose slug is still null (incl. the rows just
-- numbered above). Uses the same `slugify(title)-number` shape as PR-1.
WITH base_calc AS (
  SELECT
    id,
    trim(both '-' from regexp_replace(
      lower(coalesce(nullif(title, ''), 'untitled')),
      '[^a-z0-9]+', '-', 'g'
    )) AS base,
    "number"
  FROM "Document"
  WHERE slug IS NULL AND "number" IS NOT NULL
)
UPDATE "Document" d
SET slug = (CASE WHEN bc.base = '' THEN 'untitled' ELSE bc.base END)
        || '-' || bc."number"::text
FROM base_calc bc
WHERE d.id = bc.id;

-- Bump workspace.documentSeq to the new MAX(number) for workspaces whose seq
-- is now below the backfilled rows. No-op when documentSeq already leads.
UPDATE "workspaces" w
SET "documentSeq" = sub.max_n
FROM (
  SELECT "workspaceId", MAX("number") AS max_n
  FROM "Document"
  WHERE "number" IS NOT NULL
  GROUP BY "workspaceId"
) sub
WHERE w.id = sub."workspaceId" AND sub.max_n > w."documentSeq";

-- Enforce NOT NULL now that all rows are populated.
ALTER TABLE "Document" ALTER COLUMN "number" SET NOT NULL;
ALTER TABLE "Document" ALTER COLUMN "slug" SET NOT NULL;
