-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "taskId" TEXT;

-- CreateIndex
CREATE INDEX "sessions_taskId_lastActivityAt_idx" ON "sessions"("taskId", "lastActivityAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
