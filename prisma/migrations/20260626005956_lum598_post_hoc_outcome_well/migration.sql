-- LUM-598 事后结果井 (post-hoc outcome well). Purely additive — the well is a
-- new append-only side table plus one groundwork column on pull_requests. No
-- existing table/column is dropped or altered destructively; historical rows
-- are untouched. INVARIANT: the well stores only rejection signals (falsifier),
-- so there is no "satisfied" enum value by design.

-- CreateEnum
CREATE TYPE "OutcomeSignalKind" AS ENUM ('REVERTED', 'REOPENED', 'ROLLED_BACK', 'CI_REGRESSION', 'DOWNSTREAM_REDIRECT', 'BYPASSED', 'MANUAL');

-- CreateEnum
CREATE TYPE "OutcomeSignalSource" AS ENUM ('GIT', 'CI', 'LINEAGE', 'MANUAL');

-- AlterTable: groundwork for future automated revert detection (nullable, additive)
ALTER TABLE "pull_requests" ADD COLUMN     "mergeCommitSha" TEXT;

-- CreateTable
CREATE TABLE "outcome_signals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" "OutcomeSignalKind" NOT NULL,
    "source" "OutcomeSignalSource" NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidence" JSONB,
    "sessionId" TEXT,
    "recordedByMemberId" TEXT,

    CONSTRAINT "outcome_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outcome_signals_taskId_idx" ON "outcome_signals"("taskId");

-- CreateIndex
CREATE INDEX "outcome_signals_workspaceId_idx" ON "outcome_signals"("workspaceId");

-- AddForeignKey
ALTER TABLE "outcome_signals" ADD CONSTRAINT "outcome_signals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_signals" ADD CONSTRAINT "outcome_signals_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
