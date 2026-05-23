-- Add slug column nullable first so we can backfill existing rows.
ALTER TABLE "milestones" ADD COLUMN "slug" TEXT;

-- Backfill: slugify(name), fall back to "milestone" for empty results
-- (e.g. all-CJK names), append -2/-3/... on collisions within the same project.
DO $$
DECLARE
  m RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR m IN
    SELECT id, "projectId", name FROM "milestones" ORDER BY "createdAt" ASC, id ASC
  LOOP
    base := trim(both '-' from regexp_replace(lower(m.name), '[^a-z0-9]+', '-', 'g'));
    IF base = '' THEN
      base := 'milestone';
    END IF;
    candidate := base;
    n := 2;
    WHILE EXISTS (
      SELECT 1 FROM "milestones"
      WHERE "projectId" = m."projectId" AND slug = candidate
    ) LOOP
      candidate := base || '-' || n;
      n := n + 1;
    END LOOP;
    UPDATE "milestones" SET slug = candidate WHERE id = m.id;
  END LOOP;
END $$;

ALTER TABLE "milestones" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "milestones_projectId_slug_key" ON "milestones"("projectId", "slug");
