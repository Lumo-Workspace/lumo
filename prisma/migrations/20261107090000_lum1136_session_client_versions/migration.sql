-- LUM-1136: Lumo CLI / skill versions reported by a session's SessionStart hook.
-- Additive, nullable: no backfill, no data change.
ALTER TABLE "sessions" ADD COLUMN "cliVersion" TEXT;
ALTER TABLE "sessions" ADD COLUMN "skillVersion" TEXT;
