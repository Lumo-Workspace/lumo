-- LUM-732: PR security scan — two additive tables + seven enums.
-- No existing table or column is touched; no data is deleted.

-- CreateEnum
CREATE TYPE "PrSecurityScanStatus" AS ENUM ('PENDING', 'RUNNING', 'CLEAN', 'FINDINGS', 'FAILED');
CREATE TYPE "PrSecurityScanTrigger" AS ENUM ('PR_EVENT', 'PR_LINK');
CREATE TYPE "PrSecurityJudgeStatus" AS ENUM ('RAN', 'UNAVAILABLE', 'SKIPPED');
CREATE TYPE "PrSecurityFindingKind" AS ENUM ('SECRET', 'VULNERABILITY');
CREATE TYPE "PrSecurityFindingSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "PrSecurityFindingProvenance" AS ENUM ('DETERMINISTIC', 'LLM_JUDGE', 'EXTERNAL_TOOL');
CREATE TYPE "PrSecurityFindingDisposition" AS ENUM ('FALSE_POSITIVE', 'ACCEPTED_RISK');

-- CreateTable
CREATE TABLE "pr_security_scans" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "taskId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "status" "PrSecurityScanStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" "PrSecurityScanTrigger" NOT NULL,
    "judgeStatus" "PrSecurityJudgeStatus",
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "detectorVersion" TEXT NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "pr_security_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pr_security_findings" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "kind" "PrSecurityFindingKind" NOT NULL,
    "ruleId" TEXT NOT NULL,
    "severity" "PrSecurityFindingSeverity" NOT NULL,
    "provenance" "PrSecurityFindingProvenance" NOT NULL,
    "filePath" TEXT NOT NULL,
    "line" INTEGER,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "externalRef" TEXT,
    "disposition" "PrSecurityFindingDisposition",
    "dispositionNote" TEXT,
    "dispositionedById" TEXT,
    "dispositionedAt" TIMESTAMP(3),
    "inheritedFromFindingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pr_security_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pr_security_scans_pullRequestId_headSha_key" ON "pr_security_scans"("pullRequestId", "headSha");
CREATE INDEX "pr_security_scans_taskId_idx" ON "pr_security_scans"("taskId");
CREATE INDEX "pr_security_findings_scanId_idx" ON "pr_security_findings"("scanId");
CREATE INDEX "pr_security_findings_fingerprint_idx" ON "pr_security_findings"("fingerprint");

-- AddForeignKey
ALTER TABLE "pr_security_scans" ADD CONSTRAINT "pr_security_scans_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pr_security_scans" ADD CONSTRAINT "pr_security_scans_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pr_security_findings" ADD CONSTRAINT "pr_security_findings_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "pr_security_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
