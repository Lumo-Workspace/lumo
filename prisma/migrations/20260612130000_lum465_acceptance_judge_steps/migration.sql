-- LUM-465: agent-drafted human-readable judging instructions on a criterion.
-- Purely additive, nullable — legacy rows stay NULL (no backfill), the
-- adjudication card renders a "missing guidance" fallback for them.
ALTER TABLE "acceptance_criteria" ADD COLUMN "judgeSteps" TEXT;
