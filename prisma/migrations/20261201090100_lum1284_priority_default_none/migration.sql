-- LUM-1284: new tasks default to NONE. Existing rows keep their priority (no
-- backfill: a MEDIUM row may be a real ruling or the old default, and the two
-- cannot be told apart).
ALTER TABLE "tasks" ALTER COLUMN "priority" SET DEFAULT 'NONE';
