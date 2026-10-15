-- LUM-1154: questions asked of Lumo on a pull request (thread replies and
-- @-mentions). Additive: a new table; nothing is altered, dropped or deleted.
CREATE TABLE "pr_chat_requests" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "authorLogin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLAIMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pr_chat_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pr_chat_requests_workspaceId_source_commentId_key" ON "pr_chat_requests"("workspaceId", "source", "commentId");

CREATE INDEX "pr_chat_requests_pullRequestId_createdAt_idx" ON "pr_chat_requests"("pullRequestId", "createdAt");

ALTER TABLE "pr_chat_requests" ADD CONSTRAINT "pr_chat_requests_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
