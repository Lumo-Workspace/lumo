-- LUM-822: hunt run bookkeeping for the stale-hunt sweep (retry once, then FAILED).
-- Purely additive: four nullable / defaulted columns, no backfill.
ALTER TABLE "pr_security_scans" ADD COLUMN "huntJob" JSONB;
ALTER TABLE "pr_security_scans" ADD COLUMN "huntRunId" TEXT;
ALTER TABLE "pr_security_scans" ADD COLUMN "huntAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pr_security_scans" ADD COLUMN "huntStartedAt" TIMESTAMP(3);
