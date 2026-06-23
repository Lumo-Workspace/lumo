-- LUM-573: frozen task-level claim snapshot.
-- Additive only — all columns nullable, no backfill, no data-destructive DDL.
-- The acceptance read path degrades to a field read of these columns; the
-- run-summary worker / backfill synthesize them from the authoritative
-- (MERGED-lineage) session. Production needs `prisma migrate deploy` on the
-- next deploy, followed by the claim-snapshot backfill.
ALTER TABLE "tasks" ADD COLUMN "claimSnapshot" TEXT;
ALTER TABLE "tasks" ADD COLUMN "claimSnapshotSource" TEXT;
ALTER TABLE "tasks" ADD COLUMN "claimSnapshotSessionId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "claimSnapshotAt" TIMESTAMP(3);
