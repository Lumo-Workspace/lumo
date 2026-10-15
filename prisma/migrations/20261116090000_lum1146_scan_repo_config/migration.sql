-- LUM-1146: how the repository config file (.lumo.yaml) was read for a scan.
-- Additive: a nullable column, no backfill (null = not read).
ALTER TABLE "pr_security_scans" ADD COLUMN "repoConfig" JSONB;
