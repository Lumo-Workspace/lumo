-- LUM-866: per-workspace security-scan switches. Additive only: three
-- NOT NULL booleans with a constant default (metadata-only in Postgres 11+),
-- so every existing workspace keeps scanning exactly as before.
ALTER TABLE "workspaces" ADD COLUMN "securityScanEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "workspaces" ADD COLUMN "securityAiReviewEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "workspaces" ADD COLUMN "securityHuntEnabled" BOOLEAN NOT NULL DEFAULT true;
