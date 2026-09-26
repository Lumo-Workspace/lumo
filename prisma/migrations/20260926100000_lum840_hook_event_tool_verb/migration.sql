-- LUM-840: the command behind each Bash call's purpose bucket (cost drill-down).
-- Additive only: one nullable column, no default, no index.
ALTER TABLE "hook_events" ADD COLUMN "toolVerb" TEXT;
