-- CreateEnum
CREATE TYPE "LineageFragmentType" AS ENUM ('MEMORY', 'SLACK_CONTEXT', 'WEB_LINK', 'FIGMA', 'PR', 'PR_REVIEW_TODO', 'SESSION');

-- CreateEnum
CREATE TYPE "LineageOutcome" AS ENUM ('MERGED', 'REJECTED', 'REWORKED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "lineage_edges" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fragmentType" "LineageFragmentType" NOT NULL,
    "fragmentId" TEXT NOT NULL,
    "sessionId" TEXT,
    "runId" TEXT,
    "includedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "LineageOutcome" NOT NULL DEFAULT 'UNKNOWN',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lineage_edges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lineage_edges_fragmentType_fragmentId_idx" ON "lineage_edges"("fragmentType", "fragmentId");

-- CreateIndex
CREATE INDEX "lineage_edges_taskId_idx" ON "lineage_edges"("taskId");

-- CreateIndex
CREATE INDEX "lineage_edges_workspaceId_idx" ON "lineage_edges"("workspaceId");

-- AddForeignKey
ALTER TABLE "lineage_edges" ADD CONSTRAINT "lineage_edges_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineage_edges" ADD CONSTRAINT "lineage_edges_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineage_edges" ADD CONSTRAINT "lineage_edges_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineage_edges" ADD CONSTRAINT "lineage_edges_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

