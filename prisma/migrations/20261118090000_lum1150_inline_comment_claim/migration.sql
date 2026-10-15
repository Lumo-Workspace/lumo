-- LUM-1150 follow-up: concurrent PR write-backs never double-post an inline
-- comment. Additive only: one nullable column on pr_security_findings, the
-- claim a write-back takes before posting a row's comment. No existing row
-- changes.

-- AlterTable
ALTER TABLE "pr_security_findings" ADD COLUMN "inlineCommentClaimedAt" TIMESTAMP(3);
