-- LUM-442: boundary-crossing detector v2 — severity tiers + extended high-severity taxonomy.
--
-- Additive only. A new severity enum + column (default MEDIUM, existing rows
-- backfilled by category), and three new high-severity taxonomy classes added to
-- the existing category enum. No row is deleted; no behaviour changes until the
-- detector starts stamping severity. Production applies via `prisma migrate
-- deploy` on next deploy.

-- Severity enum (frequency×severity model: LOW | MEDIUM | HIGH).
DO $$ BEGIN
  CREATE TYPE "BoundaryCrossingSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Extended high-severity taxonomy classes (additive enum values). These are not
-- referenced by any DML below, so adding them in this migration is safe.
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'EXFILTRATION_PUBLIC';
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'CLOUD_DATA_DELETION';
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'INFRA_TERMINATION';

-- Additive severity column (default MEDIUM).
ALTER TABLE "boundary_crossings" ADD COLUMN IF NOT EXISTS "severity" "BoundaryCrossingSeverity" NOT NULL DEFAULT 'MEDIUM';

-- Backfill existing rows by taxonomy so legacy crossings carry the right tier.
-- Only references pre-existing category values (never the ones added above).
UPDATE "boundary_crossings" SET "severity" = 'LOW' WHERE "category" = 'NEW_NPM_DEPENDENCY';
UPDATE "boundary_crossings" SET "severity" = 'HIGH' WHERE "category" IN ('HARDCODED_SECRET', 'DESTRUCTIVE_DB_COMMAND');
-- PUSH_TO_PROTECTED_BRANCH and MIGRATION_FILE_DELETED keep the MEDIUM default.
