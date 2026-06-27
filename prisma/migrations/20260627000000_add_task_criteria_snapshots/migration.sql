-- CreateTable
CREATE TABLE "task_criteria_snapshots" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "trigger" TEXT NOT NULL,
    "sessionId" TEXT,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_criteria_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_criteria_snapshots_taskId_idx" ON "task_criteria_snapshots"("taskId");

-- CreateIndex
CREATE INDEX "task_criteria_snapshots_taskId_frozenAt_idx" ON "task_criteria_snapshots"("taskId", "frozenAt");

-- AddForeignKey
ALTER TABLE "task_criteria_snapshots" ADD CONSTRAINT "task_criteria_snapshots_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
