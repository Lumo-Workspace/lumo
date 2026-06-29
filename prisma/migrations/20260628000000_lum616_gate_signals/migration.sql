-- CreateTable
CREATE TABLE "gate_signals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "gateKey" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "checkName" TEXT NOT NULL,
    "detailsUrl" TEXT,
    "headSha" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gate_signals_taskId_createdAt_idx" ON "gate_signals"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "gate_signals" ADD CONSTRAINT "gate_signals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_signals" ADD CONSTRAINT "gate_signals_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
