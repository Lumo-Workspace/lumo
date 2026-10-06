-- LUM-1011: per-step results + observed actual on test case runs.
-- Additive only: existing rows get '[]' / NULL (append-only log, no backfill).
ALTER TABLE "test_case_runs" ADD COLUMN "stepResults" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "test_case_runs" ADD COLUMN "actual" TEXT;
