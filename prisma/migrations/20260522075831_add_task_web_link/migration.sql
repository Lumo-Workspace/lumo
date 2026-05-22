-- CreateTable
CREATE TABLE "task_web_links" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "note" TEXT,
    "imageUrl" TEXT,
    "faviconUrl" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "fetchError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_web_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_web_links_taskId_createdAt_idx" ON "task_web_links"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "task_web_links_workspaceId_idx" ON "task_web_links"("workspaceId");

-- AddForeignKey
ALTER TABLE "task_web_links" ADD CONSTRAINT "task_web_links_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_web_links" ADD CONSTRAINT "task_web_links_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_web_links" ADD CONSTRAINT "task_web_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "workspace_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
