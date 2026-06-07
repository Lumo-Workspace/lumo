-- AlterTable: add usageByModel to hook_events (LUM-298)
ALTER TABLE "hook_events" ADD COLUMN "usageByModel" JSONB;

-- AlterTable: add usageByModel to sessions (LUM-298)
ALTER TABLE "sessions" ADD COLUMN "usageByModel" JSONB;
