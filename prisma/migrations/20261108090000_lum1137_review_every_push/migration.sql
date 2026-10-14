-- LUM-1137: review every push (CodeRabbit `auto_incremental_review` +
-- `auto_pause_after_reviewed_commits`, default 5, 0 = never pause).
-- Additive only: two columns with constant defaults and one nullable column
-- (metadata-only in Postgres 11+); `reviewRoundLimit` is left in place and
-- no longer read.
ALTER TABLE "workspaces" ADD COLUMN "securityReviewAutoPauseAfter" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_securityReviewAutoPauseAfter_check" CHECK ("securityReviewAutoPauseAfter" BETWEEN 0 AND 100);

ALTER TABLE "pull_requests" ADD COLUMN "reviewHeadCommits" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "pull_requests" ADD COLUMN "reviewCommitLimit" INTEGER;

-- A limit a PR's owner chose with `--resume --limit` stays that PR's limit.
-- The old default (2) cannot be told apart from an explicit 2, so those PRs —
-- every open PR that never had a custom limit — adopt the workspace setting.
UPDATE "pull_requests" SET "reviewCommitLimit" = "reviewRoundLimit" WHERE "reviewRoundLimit" <> 2;
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_reviewCommitLimit_check"
  CHECK ("reviewCommitLimit" IS NULL OR "reviewCommitLimit" BETWEEN 1 AND 100);
