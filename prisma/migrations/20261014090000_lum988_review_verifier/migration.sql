-- LUM-988: agentic verifier for the AI review. Additive only: one new enum,
-- two nullable columns on pr_security_scans and two on pr_security_findings.
-- No existing row changes.

-- CreateEnum
CREATE TYPE "PrSecurityVerifierVerdict" AS ENUM ('CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "pr_security_scans" ADD COLUMN "verifierStartedAt" TIMESTAMP(3),
ADD COLUMN "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pr_security_findings" ADD COLUMN "verifierVerdict" "PrSecurityVerifierVerdict",
ADD COLUMN "verifierReason" TEXT;
