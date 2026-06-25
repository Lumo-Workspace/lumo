-- Migration: undo_human_verdict (LUM-586)
-- Adds:
--   1. verdictActionId (nullable TEXT) on VerificationRun — groups rows belonging to one human-verdict action.
--   2. VerificationRunWithdrawal table — append-only tombstone marking a withdrawn action.
--   3. VERIFICATION_RUN_WITHDRAWN value on TaskActivityType enum.

-- 1. Add verdictActionId to verification_runs
ALTER TABLE "verification_runs" ADD COLUMN "verdictActionId" TEXT;

-- 2. Add VERIFICATION_RUN_WITHDRAWN to TaskActivityType enum
ALTER TYPE "TaskActivityType" ADD VALUE 'VERIFICATION_RUN_WITHDRAWN';

-- 3. Create VerificationRunWithdrawal table
CREATE TABLE "VerificationRunWithdrawal" (
    "id"              TEXT NOT NULL,
    "taskId"          TEXT NOT NULL,
    "verdictActionId" TEXT NOT NULL,
    "withdrawnById"   TEXT,
    "note"            TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationRunWithdrawal_pkey" PRIMARY KEY ("id")
);

-- 4. Add FK: VerificationRunWithdrawal.taskId → tasks.id (cascade delete)
ALTER TABLE "VerificationRunWithdrawal" ADD CONSTRAINT "VerificationRunWithdrawal_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Unique constraint: one withdrawal per (taskId, verdictActionId)
CREATE UNIQUE INDEX "VerificationRunWithdrawal_taskId_verdictActionId_key"
    ON "VerificationRunWithdrawal"("taskId", "verdictActionId");

-- 6. Index on taskId for fast lookup
CREATE INDEX "VerificationRunWithdrawal_taskId_idx"
    ON "VerificationRunWithdrawal"("taskId");
