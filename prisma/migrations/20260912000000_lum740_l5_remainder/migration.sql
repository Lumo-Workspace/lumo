-- LUM-740 (L5 remainder): additive only.
-- One NEW enum type (CREATE TYPE — nothing in this migration uses it in the
-- same transaction) and seven nullable columns. No index: every reader keys
-- on an already-indexed scan/workspace id.
CREATE TYPE "PrSecuritySuggestionOutcome" AS ENUM ('CONFIRMED', 'OVERRULED');
ALTER TABLE "workspaces" ADD COLUMN "securityPolicy" JSONB;
ALTER TABLE "pr_security_scans" ADD COLUMN "summaryCommentId" TEXT;
ALTER TABLE "pr_security_scans" ADD COLUMN "suggestedAt" TIMESTAMP(3);
ALTER TABLE "pr_security_scans" ADD COLUMN "suggestionTokens" INTEGER;
ALTER TABLE "pr_security_findings" ADD COLUMN "suggestedDisposition" "PrSecurityFindingDisposition";
ALTER TABLE "pr_security_findings" ADD COLUMN "suggestedReason" TEXT;
ALTER TABLE "pr_security_findings" ADD COLUMN "suggestionOutcome" "PrSecuritySuggestionOutcome";
