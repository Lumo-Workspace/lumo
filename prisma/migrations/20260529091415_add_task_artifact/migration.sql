-- CreateTable
CREATE TABLE "task_artifacts" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_artifacts_taskId_order_idx" ON "task_artifacts"("taskId", "order");

-- CreateIndex
CREATE INDEX "task_artifacts_workspaceId_idx" ON "task_artifacts"("workspaceId");

-- AddForeignKey
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
