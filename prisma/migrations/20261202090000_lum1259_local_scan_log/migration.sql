-- LUM-1259: log local scan results per commit (opt-in per workspace). Additive
-- only: two new enum types, two new tables (cascade from the workspace), one
-- new Workspace column defaulting to off. No data is changed or deleted.

-- CreateEnum
CREATE TYPE "LocalScanActor" AS ENUM ('USER', 'AGENT');

-- CreateEnum
CREATE TYPE "LocalScanTrigger" AS ENUM ('POST_COMMIT', 'PRE_PUSH', 'MANUAL');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "securityLocalScanLogEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "local_scan_runs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "parentSha" TEXT,
    "patchId" TEXT,
    "branch" TEXT,
    "sessionId" TEXT,
    "taskId" TEXT,
    "actor" "LocalScanActor" NOT NULL,
    "memberId" TEXT NOT NULL,
    "trigger" "LocalScanTrigger" NOT NULL,
    "scanners" TEXT[],
    "scannerVersion" TEXT NOT NULL,
    "cliVersion" TEXT,
    "filesScanned" INTEGER NOT NULL,
    "findingCount" INTEGER NOT NULL,
    "resultKey" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_scan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_scan_findings" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "scanner" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "severity" "PrSecurityFindingSeverity" NOT NULL,
    "filePath" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "local_scan_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "local_scan_runs_workspaceId_repo_patchId_idx" ON "local_scan_runs"("workspaceId", "repo", "patchId");

-- CreateIndex
CREATE INDEX "local_scan_runs_workspaceId_createdAt_idx" ON "local_scan_runs"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "local_scan_runs_workspaceId_repo_commitSha_resultKey_key" ON "local_scan_runs"("workspaceId", "repo", "commitSha", "resultKey");

-- CreateIndex
CREATE INDEX "local_scan_findings_runId_idx" ON "local_scan_findings"("runId");

-- AddForeignKey
ALTER TABLE "local_scan_runs" ADD CONSTRAINT "local_scan_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_scan_findings" ADD CONSTRAINT "local_scan_findings_runId_fkey" FOREIGN KEY ("runId") REFERENCES "local_scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

