-- LUM-1302: application-level encryption of HookEvent.payload, per-workspace
-- envelope keys. Additive only: no column, row or value is dropped.
--
-- 1. workspace_data_keys: each workspace's data key, wrapped by
--    ENCRYPTION_KEY. Deleting a workspace deletes its keys.
-- 2. hook_events gains the columns that queries used to read out of the
--    payload with JSON paths (they stop working once the payload is
--    ciphertext), plus "payloadKeyId" naming the key that encrypted a row
--    (NULL = still plaintext).
-- 3. The new columns are filled for existing rows from the (still plaintext)
--    payload. Payload encryption of existing rows is NOT done here: it is the
--    separate scripts/encrypt-hook-event-payloads.ts run.

CREATE TABLE "workspace_data_keys" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_data_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_data_keys_workspaceId_version_key" ON "workspace_data_keys"("workspaceId", "version");

ALTER TABLE "workspace_data_keys" ADD CONSTRAINT "workspace_data_keys_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hook_events" ADD COLUMN "payloadPrunedReason" TEXT,
ADD COLUMN "payloadKeyId" TEXT,
ADD COLUMN "toolUseId" TEXT,
ADD COLUMN "promptTaskNotification" BOOLEAN NOT NULL DEFAULT false;

-- Pruned rows: the marker's reason (session-raw-record counts USER_DELETED).
UPDATE "hook_events"
SET "payloadPrunedReason" = "payload" -> '_lumo_pruned' ->> 'reason'
WHERE "payloadPrunedAt" IS NOT NULL
  AND "payload" -> '_lumo_pruned' ->> 'reason' IS NOT NULL;

-- Root prompts carrying a background task's completion notice (attribution
-- re-reads them).
UPDATE "hook_events"
SET "promptTaskNotification" = true
WHERE "type" = 'USER_PROMPT_SUBMIT'
  AND "payload" ->> 'prompt' LIKE '%<task-notification>%';

-- Pre-tool events are matched by tool_use_id only within 24 hours
-- (PRE_TOOL_LOOKBACK_MS), so only recent ones need the column.
UPDATE "hook_events"
SET "toolUseId" = "payload" ->> 'tool_use_id'
WHERE "type" = 'PRE_TOOL_USE'
  AND "createdAt" > now() - interval '2 days'
  AND "payload" ->> 'tool_use_id' IS NOT NULL;
