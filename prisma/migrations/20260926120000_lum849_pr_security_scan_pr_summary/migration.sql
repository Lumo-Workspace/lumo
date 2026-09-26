-- LUM-849: the AI review's plain-language PR description for the summary comment.
-- Additive only: one nullable JSONB column, no default, no index.
ALTER TABLE "pr_security_scans" ADD COLUMN "prSummary" JSONB;
