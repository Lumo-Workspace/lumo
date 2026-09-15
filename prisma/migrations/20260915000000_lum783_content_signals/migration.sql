-- LUM-783: record content-level injection hits on the SOURCE row, not on the
-- agent. Each untrusted-content source card (Slack context, web link, comment,
-- memory, task artifact) gains one nullable JSONB column holding the scan
-- summary written at write time ({ counts, wrapperEscapes, total, scannedAt });
-- null means clean or not yet scanned. Purely additive: five new nullable
-- columns, no table, index or data change.

-- AlterTable
ALTER TABLE "task_slack_contexts" ADD COLUMN IF NOT EXISTS "contentSignals" JSONB;

-- AlterTable
ALTER TABLE "task_web_links" ADD COLUMN IF NOT EXISTS "contentSignals" JSONB;

-- AlterTable
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "contentSignals" JSONB;

-- AlterTable
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "contentSignals" JSONB;

-- AlterTable
ALTER TABLE "task_artifacts" ADD COLUMN IF NOT EXISTS "contentSignals" JSONB;
