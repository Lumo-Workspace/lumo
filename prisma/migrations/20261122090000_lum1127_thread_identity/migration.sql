-- LUM-1127 follow-up #2: the identity of the finding an inline review thread
-- stands for, kept on the thread row (a same-head full re-review replaces the
-- scan's finding rows). Keyed hashes only — no code or title text. Additive: nullable columns and
-- an array with a default, no backfill (rows fill in on their next sync).
ALTER TABLE "pr_finding_threads" ADD COLUMN "identityRuleId" TEXT;
ALTER TABLE "pr_finding_threads" ADD COLUMN "identityLine" INTEGER;
ALTER TABLE "pr_finding_threads" ADD COLUMN "identitySeverity" "PrSecurityFindingSeverity";
ALTER TABLE "pr_finding_threads" ADD COLUMN "identityEvidenceHash" TEXT;
ALTER TABLE "pr_finding_threads" ADD COLUMN "identityTitleTokens" TEXT[] DEFAULT ARRAY[]::TEXT[];
