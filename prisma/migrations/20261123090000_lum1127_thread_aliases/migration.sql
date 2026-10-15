-- LUM-1127 follow-up #3: the fingerprints an inline review thread was carried
-- to (the same issue relabelled by a later review), so a mid-review sync never
-- posts the relabelled finding as a second thread. Additive: an array with a
-- default, no backfill (rows fill in on their next carry).
ALTER TABLE "pr_finding_threads" ADD COLUMN "aliasFingerprints" TEXT[] DEFAULT ARRAY[]::TEXT[];
