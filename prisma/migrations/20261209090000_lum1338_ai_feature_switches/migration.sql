-- LUM-1338: per-workspace AI feature switches (master / group / feature).
-- Additive: existing workspaces start with '{}' = every switch on, so their
-- behaviour is unchanged.
ALTER TABLE "workspaces" ADD COLUMN "aiFeatureSwitches" JSONB NOT NULL DEFAULT '{}';
