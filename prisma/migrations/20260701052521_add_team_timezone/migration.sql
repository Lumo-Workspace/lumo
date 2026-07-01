-- Add per-team IANA timezone; existing teams backfill to Pacific.
ALTER TABLE "teams" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles';
