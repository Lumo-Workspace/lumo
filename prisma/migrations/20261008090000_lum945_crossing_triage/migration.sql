-- LUM-945: AI triage of boundary crossings. Additive only: three nullable
-- columns and one index. Existing rows read as "not triaged yet".
ALTER TABLE "boundary_crossings" ADD COLUMN "triageProbability" DOUBLE PRECISION;
ALTER TABLE "boundary_crossings" ADD COLUMN "triageModel" TEXT;
ALTER TABLE "boundary_crossings" ADD COLUMN "triagedAt" TIMESTAMP(3);

CREATE INDEX "boundary_crossings_triagedAt_disposition_idx" ON "boundary_crossings"("triagedAt", "disposition");
