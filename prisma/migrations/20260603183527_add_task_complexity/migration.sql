-- CreateTable
CREATE TABLE "task_complexities" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "totalDurationMs" INTEGER NOT NULL,
    "changedFileCount" INTEGER NOT NULL,
    "agentRunCount" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_complexities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_complexities_taskId_key" ON "task_complexities"("taskId");

-- CreateIndex
CREATE INDEX "task_complexities_teamId_idx" ON "task_complexities"("teamId");

-- AddForeignKey
ALTER TABLE "task_complexities" ADD CONSTRAINT "task_complexities_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
