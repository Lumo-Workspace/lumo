-- CreateTable
CREATE TABLE "task_slack_contexts" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "permalink" TEXT NOT NULL,
    "slackTeamId" TEXT NOT NULL,
    "slackChannelId" TEXT NOT NULL,
    "slackChannelName" TEXT,
    "rootTs" TEXT NOT NULL,
    "threadTs" TEXT,
    "isThread" BOOLEAN NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "refreshError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_slack_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_slack_contexts_taskId_idx" ON "task_slack_contexts"("taskId");

-- CreateIndex
CREATE INDEX "task_slack_contexts_workspaceId_idx" ON "task_slack_contexts"("workspaceId");

-- AddForeignKey
ALTER TABLE "task_slack_contexts" ADD CONSTRAINT "task_slack_contexts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_slack_contexts" ADD CONSTRAINT "task_slack_contexts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_slack_contexts" ADD CONSTRAINT "task_slack_contexts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "workspace_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
