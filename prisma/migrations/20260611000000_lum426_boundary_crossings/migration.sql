-- LUM-426: async forbidden-action boundary detector.
-- Additive only — new enum, two TaskActivityType values, one default-ON Boolean
-- column, one table. No destructive step, no data migration. Production applies
-- via `prisma migrate deploy` on next deploy; the default-on gate is live the
-- moment the column exists.

-- Category enum for boundary-crossings.
DO $$ BEGIN
  CREATE TYPE "BoundaryCrossingCategory" AS ENUM (
    'PUSH_TO_PROTECTED_BRANCH',
    'MIGRATION_FILE_DELETED',
    'HARDCODED_SECRET',
    'NEW_NPM_DEPENDENCY',
    'DESTRUCTIVE_DB_COMMAND'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Timeline marker activity types.
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'BOUNDARY_CROSSING_DETECTED';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'BOUNDARY_CROSSING_ACKNOWLEDGED';

-- Default-ON DONE gate toggle (opting out drops the block, never the flagging).
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "boundaryGateEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Boundary-crossing markers — the mutable acknowledgement state the DONE gate reads.
CREATE TABLE IF NOT EXISTS "boundary_crossings" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "hookEventId" TEXT,
    "category" "BoundaryCrossingCategory" NOT NULL,
    "detail" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    CONSTRAINT "boundary_crossings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "boundary_crossings_taskId_acknowledgedAt_idx" ON "boundary_crossings"("taskId", "acknowledgedAt");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boundary_crossings_taskId_fkey'
  ) THEN
    ALTER TABLE "boundary_crossings" ADD CONSTRAINT "boundary_crossings_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
