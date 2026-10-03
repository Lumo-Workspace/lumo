-- LUM-933 / LUM-910 / LUM-912 / LUM-941: per-category data retention settings.
-- Additive only: a new enum, new columns with defaults, one index.
-- Session records stay "keep forever" for every existing workspace (mode
-- RETAIN, hookEventRetentionDays untouched). Existing workspaces get
-- crossingRawRetentionSince = migration time, so crossings dispositioned
-- before this deploy are never purged automatically.
CREATE TYPE "HookEventRetentionMode" AS ENUM ('RETAIN', 'USED_UP');

ALTER TABLE "workspaces" ADD COLUMN "hookEventRetentionMode" "HookEventRetentionMode" NOT NULL DEFAULT 'RETAIN';
-- A stricter session record setting only governs events stored after the
-- change: NULL on every existing workspace (no cutoff yet).
ALTER TABLE "workspaces" ADD COLUMN "hookEventRetentionSince" TIMESTAMP(3);
ALTER TABLE "workspaces" ADD COLUMN "hookEventRetentionLegacyDays" INTEGER;
ALTER TABLE "workspaces" ADD COLUMN "crossingRawRetentionDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "workspaces" ADD COLUMN "crossingRawRetentionSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "workspaces" ADD COLUMN "deadLetterRetentionDays" INTEGER NOT NULL DEFAULT 7;

ALTER TABLE "boundary_crossings" ADD COLUMN "rawPurgedAt" TIMESTAMP(3);

CREATE INDEX "boundary_crossings_rawPurgedAt_dispositionedAt_idx" ON "boundary_crossings"("rawPurgedAt", "dispositionedAt");
