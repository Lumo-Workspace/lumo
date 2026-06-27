-- LUM-606: freeze verification-friction (two raw scalars) on the delivery snapshot.
-- Nullable: existing rows + genuine no-verification deliveries stay NULL
-- (the no-verification bucket), distinct from a real zero-friction value.
ALTER TABLE "task_forecast_snapshots" ADD COLUMN "verificationRounds" INTEGER;
ALTER TABLE "task_forecast_snapshots" ADD COLUMN "sendBackCount" INTEGER;
