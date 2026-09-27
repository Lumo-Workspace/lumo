-- LUM-859: optional raw hook-event retention. Additive only: two nullable
-- columns, no default, no backfill (metadata-only in Postgres).
ALTER TABLE "workspaces" ADD COLUMN "hookEventRetentionDays" INTEGER;
ALTER TABLE "hook_events" ADD COLUMN "payloadPrunedAt" TIMESTAMP(3);
