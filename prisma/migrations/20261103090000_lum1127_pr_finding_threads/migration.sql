-- LUM-1127: per-PR finding threads (durable identity of Lumo inline review
-- comments across head commits) + the judge review scope on each scan.
-- Purely additive: one new enum, one new table, one nullable column. No data
-- migration; existing marker comments are adopted lazily by the next sync.

-- CreateEnum
CREATE TYPE "PrFindingThreadState" AS ENUM ('OPEN', 'ADDRESSED', 'RESOLVED_BY_USER', 'DISMISSED');

-- AlterTable
ALTER TABLE "pr_security_scans" ADD COLUMN     "judgeReviewScope" JSONB;

-- CreateTable
CREATE TABLE "pr_finding_threads" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "threadNodeId" TEXT,
    "state" "PrFindingThreadState" NOT NULL DEFAULT 'OPEN',
    "ruleId" TEXT NOT NULL,
    "provenance" "PrSecurityFindingProvenance" NOT NULL,
    "kind" "PrSecurityFindingKind" NOT NULL,
    "filePath" TEXT NOT NULL,
    "resolvedByLogin" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "addressedInSha" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pr_finding_threads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pr_finding_threads_pullRequestId_state_idx" ON "pr_finding_threads"("pullRequestId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "pr_finding_threads_pullRequestId_fingerprint_key" ON "pr_finding_threads"("pullRequestId", "fingerprint");

-- AddForeignKey
ALTER TABLE "pr_finding_threads" ADD CONSTRAINT "pr_finding_threads_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

