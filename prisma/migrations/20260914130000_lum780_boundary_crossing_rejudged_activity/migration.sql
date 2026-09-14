-- LUM-780: the boundary-crossing re-judge leaves an append-only trail when a
-- SYSTEM pass flips an OPEN blocking crossing to advisory because its cause
-- no longer holds (the rule text is still in CLAUDE.md / no linked PR removes
-- a tracked test file). Purely additive enum value; no table or data change.

-- AlterEnum
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'BOUNDARY_CROSSING_REJUDGED';
