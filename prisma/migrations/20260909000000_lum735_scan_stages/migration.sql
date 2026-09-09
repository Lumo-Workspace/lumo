-- LUM-735: per-layer stage outcomes + partial flag on pr_security_scans.
-- Purely additive: two columns, no data touched.
ALTER TABLE "pr_security_scans" ADD COLUMN "stages" JSONB;
ALTER TABLE "pr_security_scans" ADD COLUMN "partial" BOOLEAN NOT NULL DEFAULT false;
