-- Add turnSummary column for STOP / STOP_FAILURE rows. Nullable —
-- populated async, no backfill needed.
ALTER TABLE "hook_events" ADD COLUMN "turnSummary" TEXT;
