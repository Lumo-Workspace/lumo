-- Add inputReason column to tasks
ALTER TABLE "tasks" ADD COLUMN "inputReason" TEXT;

-- Backfill: existing SPEC_REVIEW rows get inputReason='spec_review' and status→PAUSED
UPDATE "tasks"
  SET "inputReason" = 'spec_review', "agentStatus" = 'PAUSED'
  WHERE "agentStatus" = 'SPEC_REVIEW';

-- Backfill: existing PAUSED rows (clarify) get inputReason='clarify'
UPDATE "tasks"
  SET "inputReason" = 'clarify'
  WHERE "agentStatus" = 'PAUSED' AND "inputReason" IS NULL;

-- Same for agent_runs that reference SPEC_REVIEW
UPDATE "agent_runs"
  SET "status" = 'PAUSED'
  WHERE "status" = 'SPEC_REVIEW';

-- Remove SPEC_REVIEW from the enum
ALTER TYPE "AgentStatus" RENAME VALUE 'SPEC_REVIEW' TO 'SPEC_REVIEW_DEPRECATED';
-- Note: Postgres doesn't support DROP VALUE from enum directly.
-- The deprecated value will remain in the type but is no longer used by application code.
-- A future migration can recreate the enum without it if needed.
