-- LUM-644: advisory milestone token budget. Purely additive nullable column;
-- no data is touched and nothing is gated on it.
ALTER TABLE "milestones" ADD COLUMN "tokenBudget" INTEGER;
