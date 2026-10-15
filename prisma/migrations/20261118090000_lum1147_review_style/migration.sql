-- LUM-1147: per-repository review style (path instructions, review profile,
-- tone) and the profile a scan ran with. Additive: new columns with
-- defaults / nullable, no backfill (defaults = today's behaviour).
ALTER TABLE "repository_review_settings" ADD COLUMN "pathInstructions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "repository_review_settings" ADD COLUMN "reviewProfile" TEXT NOT NULL DEFAULT 'chill';
ALTER TABLE "repository_review_settings" ADD COLUMN "toneInstructions" TEXT;
ALTER TABLE "pr_security_scans" ADD COLUMN "reviewProfile" TEXT;
