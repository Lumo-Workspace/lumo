-- LUM-735 (SARIF push): additive only.
-- The enum value is added in its own statement and is not used by any row in
-- this migration (PG: a new enum value cannot be used in the same transaction).
ALTER TYPE "PrSecurityScanTrigger" ADD VALUE 'SARIF_PUSH';
ALTER TABLE "api_keys" ADD COLUMN "scope" TEXT;
ALTER TABLE "project_repositories" ADD COLUMN "lastSarifIngestAt" TIMESTAMP(3);
