-- LUM-932: subagent child sessions + provenance of explicit task bindings.
-- Additive and nullable; the backfill only stamps provenance on rows that
-- already carry a binding (all of them came from `lumo session attach`).
CREATE TYPE "SessionBindingSource" AS ENUM ('ATTACH', 'INHERITED');

ALTER TABLE "sessions"
  ADD COLUMN "parentSessionId" TEXT,
  ADD COLUMN "agentId" TEXT,
  ADD COLUMN "agentType" TEXT,
  ADD COLUMN "bindingSource" "SessionBindingSource";

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_parentSessionId_fkey"
  FOREIGN KEY ("parentSessionId") REFERENCES "sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "sessions_parentSessionId_idx" ON "sessions"("parentSessionId");

UPDATE "sessions" SET "bindingSource" = 'ATTACH' WHERE "taskId" IS NOT NULL;
