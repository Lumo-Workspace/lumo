-- LUM-429: machine verification round cap is now configurable per workspace.
-- Additive, non-destructive: every existing workspace reads the prior hardcoded
-- cap of 3 via the column default — no data backfill, no DROP.
ALTER TABLE "workspaces" ADD COLUMN "verificationMaxRounds" INTEGER NOT NULL DEFAULT 3;
