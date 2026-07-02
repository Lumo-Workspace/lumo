-- LUM-634 change-volume pipeline: three nullable Int columns on pull_requests.
-- Purely additive — no DROP, no data rewrite. null = not synced/backfilled yet
-- (fail-closed), distinct from a real 0 (zero-change PR).
ALTER TABLE "pull_requests" ADD COLUMN     "additions" INTEGER;
ALTER TABLE "pull_requests" ADD COLUMN     "deletions" INTEGER;
ALTER TABLE "pull_requests" ADD COLUMN     "changedFiles" INTEGER;
