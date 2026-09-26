-- LUM-840: purpose bucket for Bash tool calls (operation-cost split).
-- Additive only: one nullable column, no default, no index.
ALTER TABLE "hook_events" ADD COLUMN "toolDetail" TEXT;
