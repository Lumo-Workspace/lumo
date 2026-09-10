-- LUM-738 (L2 supply chain): additive only.
-- The enum value is added in its own statement and is not used by any row in
-- this migration (PG: a new enum value cannot be used in the same transaction).
ALTER TYPE "PrSecurityFindingKind" ADD VALUE 'DEPENDENCY';
ALTER TABLE "pr_security_findings" ADD COLUMN "persisting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "project_repositories" ADD COLUMN "securityBaseline" JSONB;
