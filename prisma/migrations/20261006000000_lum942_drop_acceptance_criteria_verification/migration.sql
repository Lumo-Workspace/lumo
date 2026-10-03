-- LUM-942: remove task-level acceptance criteria + `lumo verify` / verification rounds.
--
-- DATA-DESTRUCTIVE: permanently deletes every task acceptance criterion, every
-- verification run (all rounds, machine and human verdicts), every verdict
-- withdrawal, every delivery-time criteria snapshot and the frozen
-- verification-friction scalars on task_forecast_snapshots and the
-- lineage_edges.outcomeVerified flag. Test cases are kept;
-- only their link to a criterion is dropped.
--
-- Kept on purpose: enums AcceptanceCriterionSource + ReferentKind (still used
-- by milestone_exit_criteria), and the now-unused TaskActivityType /
-- BoundaryCrossingCategory values (Postgres cannot drop enum values and old
-- activity / crossing rows still carry them).

-- test_cases → acceptance_criteria link
ALTER TABLE "test_cases" DROP CONSTRAINT IF EXISTS "test_cases_criterionId_fkey";
DROP INDEX IF EXISTS "test_cases_criterionId_idx";
ALTER TABLE "test_cases" DROP COLUMN IF EXISTS "criterionId";

-- verification log (child tables first)
DROP TABLE IF EXISTS "VerificationRunWithdrawal";
DROP TABLE IF EXISTS "verification_runs";
DROP TABLE IF EXISTS "task_criteria_snapshots";
DROP TABLE IF EXISTS "acceptance_criteria";

DROP TYPE IF EXISTS "VerificationRejectionReason";
DROP TYPE IF EXISTS "VerificationVerdict";
DROP TYPE IF EXISTS "AcceptanceVerifierType";

-- LUM-606 verification-friction scalars frozen on the forecast snapshot
ALTER TABLE "task_forecast_snapshots" DROP COLUMN IF EXISTS "verificationRounds";
ALTER TABLE "task_forecast_snapshots" DROP COLUMN IF EXISTS "sendBackCount";

-- LUM-397 "verified merge" flag, derived only from verification rounds
ALTER TABLE "lineage_edges" DROP COLUMN IF EXISTS "outcomeVerified";

-- workspace settings that only governed the removed loop
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "verificationMaxRounds";
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "acceptanceMode";
