-- Add projectId column (nullable FK)
ALTER TABLE "slack_channels"
  ADD COLUMN IF NOT EXISTS "projectId" TEXT REFERENCES "projects"("id") ON DELETE CASCADE;

-- Drop old unique constraint
DROP INDEX IF EXISTS "slack_channels_integrationId_channelId_key";

-- Partial unique index: one channel per project (non-null rows only)
-- channelId excluded intentionally — one record per project regardless of which channel
CREATE UNIQUE INDEX "slack_channels_integrationId_projectId_key"
  ON "slack_channels"("integrationId", "projectId")
  WHERE "projectId" IS NOT NULL;

-- Plain index on projectId for efficient project-scoped lookups
CREATE INDEX IF NOT EXISTS "slack_channels_projectId_idx"
  ON "slack_channels"("projectId");
