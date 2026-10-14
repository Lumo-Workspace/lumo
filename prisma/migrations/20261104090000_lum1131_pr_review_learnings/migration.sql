-- LUM-1131: thread replies become learnings. Purely additive: one nullable
-- column on pr_finding_threads (the last reply Lumo answered — webhook
-- redelivery dedup) and one new table (a learning's repository scope; its
-- text is the linked memory row, which deleting removes the learning with).
-- No data migration, nothing deleted.

-- AlterTable
ALTER TABLE "pr_finding_threads" ADD COLUMN     "lastReplyId" TEXT;

-- CreateTable
CREATE TABLE "pr_review_learnings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "pathGlob" TEXT,
    "ruleId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourcePullRequestId" TEXT,
    "sourceReplyId" TEXT NOT NULL,
    "authorLogin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pr_review_learnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pr_review_learnings_memoryId_key" ON "pr_review_learnings"("memoryId");

-- CreateIndex
CREATE INDEX "pr_review_learnings_workspaceId_repo_idx" ON "pr_review_learnings"("workspaceId", "repo");

-- CreateIndex
CREATE UNIQUE INDEX "pr_review_learnings_workspaceId_sourceReplyId_key" ON "pr_review_learnings"("workspaceId", "sourceReplyId");

-- AddForeignKey
ALTER TABLE "pr_review_learnings" ADD CONSTRAINT "pr_review_learnings_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
