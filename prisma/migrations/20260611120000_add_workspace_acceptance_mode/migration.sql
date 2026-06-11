-- LUM-431: acceptance mode is a per-workspace toggle, default OFF.
-- Additive, non-destructive: every existing workspace reads `false` via the
-- column default — the ritual layer (draft-criteria nudge) stays suppressed
-- until an OWNER turns it on. No data backfill, no DROP.
ALTER TABLE "workspaces" ADD COLUMN "acceptanceMode" BOOLEAN NOT NULL DEFAULT false;
