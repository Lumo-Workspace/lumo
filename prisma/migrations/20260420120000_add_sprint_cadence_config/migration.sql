-- AlterTable: add sprint cadence config columns to teams.
-- See Team model for semantics. Defaults pick a sensible "2-week Monday" cadence.
ALTER TABLE "teams"
  ADD COLUMN "sprintDurationDays" INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN "sprintCooldownDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sprintStartWeekday" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "sprintAutoCreate"   INTEGER NOT NULL DEFAULT 0;
