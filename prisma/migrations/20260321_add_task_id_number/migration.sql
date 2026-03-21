-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "number" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "taskSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "tasks_teamId_idx" ON "tasks"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_teamId_number_key" ON "tasks"("teamId", "number");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
