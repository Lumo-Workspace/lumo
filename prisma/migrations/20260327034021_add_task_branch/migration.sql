-- CreateTable
CREATE TABLE "task_branches" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_branches_taskId_idx" ON "task_branches"("taskId");

-- AddForeignKey
ALTER TABLE "task_branches" ADD CONSTRAINT "task_branches_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
