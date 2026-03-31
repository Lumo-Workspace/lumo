-- AlterTable
ALTER TABLE "agent_clarifies" ADD COLUMN     "agentRunId" TEXT;

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "status" "AgentStatus" NOT NULL,
    "trigger" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "summary" TEXT,
    "changedFiles" JSONB,
    "durationMs" INTEGER,
    "prNumber" INTEGER,
    "prUrl" TEXT,
    "branchName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_runs_taskId_idx" ON "agent_runs"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_taskId_runNumber_key" ON "agent_runs"("taskId", "runNumber");

-- CreateIndex
CREATE INDEX "agent_clarifies_agentRunId_idx" ON "agent_clarifies"("agentRunId");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_clarifies" ADD CONSTRAINT "agent_clarifies_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
