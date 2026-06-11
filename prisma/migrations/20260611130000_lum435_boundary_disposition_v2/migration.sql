-- LUM-435: boundary-crossing disposition model v2.
-- Additive columns + a data-preserving rename (acknowledged* -> dispositioned*)
-- + a disposition enum + two TaskActivityType values + a remediation FK.
--
-- Data migration: the DONE gate now keys off `disposition` (not the renamed
-- timestamp). Previously-acknowledged crossings are backfilled to CONFIRMED so
-- they STAY cleared and don't re-block DONE. `reversible` is backfilled by the
-- detector taxonomy (only npm installs are reversible).
--
-- Production applies via `prisma migrate deploy` on next deploy. No row is
-- deleted; the rename keeps all existing acknowledgement data.

-- Disposition enum (FALSE_POSITIVE | CONFIRMED; null = open / blocks DONE).
DO $$ BEGIN
  CREATE TYPE "BoundaryCrossingDisposition" AS ENUM ('FALSE_POSITIVE', 'CONFIRMED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- New timeline marker activity types.
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'BOUNDARY_CROSSING_DISPOSITIONED';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'BOUNDARY_CROSSING_REMEDIATION_SPAWNED';

-- Rename the mutable resolution columns (data-preserving, idempotent).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boundary_crossings' AND column_name = 'acknowledgedAt') THEN
    ALTER TABLE "boundary_crossings" RENAME COLUMN "acknowledgedAt" TO "dispositionedAt";
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'boundary_crossings' AND column_name = 'acknowledgedById') THEN
    ALTER TABLE "boundary_crossings" RENAME COLUMN "acknowledgedById" TO "dispositionedById";
  END IF;
END $$;

-- New columns.
ALTER TABLE "boundary_crossings" ADD COLUMN IF NOT EXISTS "reversible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "boundary_crossings" ADD COLUMN IF NOT EXISTS "disposition" "BoundaryCrossingDisposition";
ALTER TABLE "boundary_crossings" ADD COLUMN IF NOT EXISTS "dispositionNote" TEXT;
ALTER TABLE "boundary_crossings" ADD COLUMN IF NOT EXISTS "remediationTaskId" TEXT;

-- Backfill: keep already-acknowledged crossings cleared under the disposition gate.
UPDATE "boundary_crossings"
  SET "disposition" = 'CONFIRMED'
  WHERE "dispositionedAt" IS NOT NULL AND "disposition" IS NULL;

-- Backfill reversibility by taxonomy (only NEW_NPM_DEPENDENCY is reversible).
UPDATE "boundary_crossings"
  SET "reversible" = true
  WHERE "category" = 'NEW_NPM_DEPENDENCY';

-- Swap the index: gate now queries by disposition, not the renamed timestamp.
DROP INDEX IF EXISTS "boundary_crossings_taskId_acknowledgedAt_idx";
CREATE INDEX IF NOT EXISTS "boundary_crossings_taskId_disposition_idx" ON "boundary_crossings"("taskId", "disposition");

-- Remediation FK (nullable; SET NULL so deleting the fix task keeps the record).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boundary_crossings_remediationTaskId_fkey'
  ) THEN
    ALTER TABLE "boundary_crossings" ADD CONSTRAINT "boundary_crossings_remediationTaskId_fkey" FOREIGN KEY ("remediationTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
