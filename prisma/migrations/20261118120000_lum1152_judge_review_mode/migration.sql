-- LUM-1152 follow-up: how the AI review on this head was asked for
-- ("full" | "incremental"); additive, nullable, no backfill (null = unknown).
ALTER TABLE "pr_security_scans" ADD COLUMN "judgeReviewMode" TEXT;
