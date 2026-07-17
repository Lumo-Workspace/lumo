-- LUM-684: GitHub pull requests cited as evidence for an Idea.
--
-- Purely additive: a new join table, no changes to `pull_requests` or `ideas`.
-- A task OWNS its PR (pull_requests.taskId, one task per PR); an idea only
-- CITES one, so the same PR can back several ideas and citing it never steals
-- it from a task.

-- CreateTable
CREATE TABLE "idea_pull_requests" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idea_pull_requests_ideaId_pullRequestId_key" ON "idea_pull_requests"("ideaId", "pullRequestId");

-- CreateIndex
CREATE INDEX "idea_pull_requests_ideaId_createdAt_idx" ON "idea_pull_requests"("ideaId", "createdAt");

-- CreateIndex
CREATE INDEX "idea_pull_requests_pullRequestId_idx" ON "idea_pull_requests"("pullRequestId");

-- CreateIndex
CREATE INDEX "idea_pull_requests_workspaceId_idx" ON "idea_pull_requests"("workspaceId");

-- AddForeignKey
ALTER TABLE "idea_pull_requests" ADD CONSTRAINT "idea_pull_requests_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_pull_requests" ADD CONSTRAINT "idea_pull_requests_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_pull_requests" ADD CONSTRAINT "idea_pull_requests_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_pull_requests" ADD CONSTRAINT "idea_pull_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "workspace_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
