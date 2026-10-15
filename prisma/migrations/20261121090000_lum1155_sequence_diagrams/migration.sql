-- LUM-1155: the per-repository switch for the call-flow sequence diagram in
-- the PR summary comment (default on), and the diagram a scan drew.
-- Additive: a column with a default and a nullable column, no backfill.
ALTER TABLE "repository_review_settings" ADD COLUMN "sequenceDiagrams" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "pr_security_scans" ADD COLUMN "sequenceDiagram" JSONB;
