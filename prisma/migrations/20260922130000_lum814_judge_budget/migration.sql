-- LUM-814: record the L2 judge's budget arithmetic on the scan row.
-- Purely additive: one nullable column, no backfill. Existing rows stay NULL
-- and the read-out says "not recorded" for them — a missing budget must never
-- render as a budget of zero.
ALTER TABLE "pr_security_scans" ADD COLUMN "judgeBudget" JSONB;
