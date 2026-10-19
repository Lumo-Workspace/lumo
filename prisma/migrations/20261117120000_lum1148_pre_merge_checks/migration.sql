-- LUM-1148: pre-merge checks. Additive: nullable columns, no backfill.
-- The repository's check settings (null = the defaults).
ALTER TABLE "repository_review_settings" ADD COLUMN "preMergeChecks" JSONB;
-- The checks' results on a scan's head (null = no check ran).
ALTER TABLE "pr_security_scans" ADD COLUMN "preMergeChecks" JSONB;
-- The per-PR override (`ignore pre-merge checks`), recorded.
ALTER TABLE "pull_requests" ADD COLUMN "preMergeOverrideBy" TEXT;
ALTER TABLE "pull_requests" ADD COLUMN "preMergeOverrideAt" TIMESTAMP(3);
ALTER TABLE "pull_requests" ADD COLUMN "preMergeOverrideSha" TEXT;
