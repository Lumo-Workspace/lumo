-- LUM-1150 follow-up: concurrent PR write-backs never create two security
-- summary comments. Additive only: a new table holding at most one claim per
-- pull request (the right to create its summary comment). No existing row
-- changes.

-- CreateTable
CREATE TABLE "pr_security_summary_claims" (
    "pullRequestId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pr_security_summary_claims_pkey" PRIMARY KEY ("pullRequestId")
);

-- AddForeignKey
ALTER TABLE "pr_security_summary_claims" ADD CONSTRAINT "pr_security_summary_claims_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
