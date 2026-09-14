-- LUM-739 (L3 hunt): additive only.
-- Two NEW enum types (CREATE TYPE, not ADD VALUE — nothing in this migration
-- uses them in the same transaction), six nullable columns, one index.
CREATE TYPE "PrSecurityReachability" AS ENUM ('EXTERNAL', 'INTERNAL', 'UNKNOWN');
CREATE TYPE "PrSecurityFalsifierVerdict" AS ENUM ('REJECT', 'INCONCLUSIVE');
ALTER TABLE "pr_security_scans" ADD COLUMN "tokenSpent" INTEGER;
ALTER TABLE "pr_security_scans" ADD COLUMN "huntAudit" JSONB;
ALTER TABLE "pr_security_findings" ADD COLUMN "cwe" TEXT;
ALTER TABLE "pr_security_findings" ADD COLUMN "reachability" "PrSecurityReachability";
ALTER TABLE "pr_security_findings" ADD COLUMN "callChain" JSONB;
ALTER TABLE "pr_security_findings" ADD COLUMN "falsifierVerdict" "PrSecurityFalsifierVerdict";
CREATE INDEX "pr_security_findings_scanId_provenance_severity_idx" ON "pr_security_findings"("scanId", "provenance", "severity");
