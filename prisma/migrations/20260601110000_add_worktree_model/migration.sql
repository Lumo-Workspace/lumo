-- CreateTable
CREATE TABLE "worktrees" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "branch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "worktrees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worktrees_workspaceId_path_key" ON "worktrees"("workspaceId", "path");

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "worktreeId" TEXT;

-- CreateIndex
CREATE INDEX "sessions_worktreeId_idx" ON "sessions"("worktreeId");

-- AddForeignKey
ALTER TABLE "worktrees" ADD CONSTRAINT "worktrees_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_worktreeId_fkey" FOREIGN KEY ("worktreeId") REFERENCES "worktrees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
