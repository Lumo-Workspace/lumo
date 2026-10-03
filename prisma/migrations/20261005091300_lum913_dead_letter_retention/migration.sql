-- LUM-913: dead-lettered PR comment sync jobs drop their GitHub webhook
-- payload 7 days after entering DEAD_LETTER.
-- Additive and nullable (no table rewrite, no backfill). Rows dead-lettered
-- before this migration keep "deadLetteredAt" NULL, so the automatic prune
-- never reaches them; the historical stock is handled separately (LUM-914).
ALTER TABLE "pr_comment_sync_jobs" ADD COLUMN "deadLetteredAt" TIMESTAMP(3);
ALTER TABLE "pr_comment_sync_jobs" ADD COLUMN "payloadPurgedAt" TIMESTAMP(3);

CREATE INDEX "pr_comment_sync_jobs_status_deadLetteredAt_idx" ON "pr_comment_sync_jobs"("status", "deadLetteredAt");
