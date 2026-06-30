-- LUM-617: group the mechanical-gate audit by PR.
-- Additive + nullable: existing rows (and any commit that maps to no PR) keep NULL.
ALTER TABLE "gate_signals" ADD COLUMN "prNumber" INTEGER;
