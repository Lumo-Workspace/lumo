-- LUM-832: attribute every "scan not whole" to a cause (our fault vs coverage
-- still owed). Purely additive: one defaulted text[] column, no backfill.
-- Existing rows keep `partial` and read as unattributed.
ALTER TABLE "pr_security_scans" ADD COLUMN "partialCauses" TEXT[] DEFAULT ARRAY[]::TEXT[];
