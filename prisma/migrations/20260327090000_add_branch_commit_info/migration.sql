-- AlterTable: add commit tracking fields to task_branches
ALTER TABLE "task_branches"
  ADD COLUMN "lastCommitSha"     TEXT,
  ADD COLUMN "lastCommitMessage" TEXT,
  ADD COLUMN "lastCommitAuthor"  TEXT,
  ADD COLUMN "lastPushedAt"      TIMESTAMP(3);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "task_branches_taskId_repo_branchName_key"
  ON "task_branches"("taskId", "repo", "branchName");
