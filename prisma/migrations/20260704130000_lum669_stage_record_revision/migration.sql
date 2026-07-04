-- LUM-669: optimistic-concurrency token for the web gate (cf. doc LUM-409
-- ifRevision). The board reads `revision`, submits it back on confirm, and the
-- service 409s on a mismatch rather than clobbering a concurrent edit.

-- AlterTable
ALTER TABLE "plan_run_stage_records" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;
