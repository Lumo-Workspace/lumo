-- LUM-1151: where the high-level PR summary goes, per repository, and the
-- value in force when a scan ran. Additive: a column with a default and a
-- nullable column, no backfill (default = the PR description).
ALTER TABLE "repository_review_settings" ADD COLUMN "highLevelSummary" TEXT NOT NULL DEFAULT 'description';
ALTER TABLE "pr_security_scans" ADD COLUMN "highLevelSummary" TEXT;
