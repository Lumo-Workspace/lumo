-- LUM-821 initiative progress updates (`lumo initiative progress add/list`)
--
-- Purely additive: one new enum type + one new table + one index + one FK.
-- No DROP, no backfill, no change to existing columns or enum values.
--
-- Append-only: an update is never edited; a correction is a new row, so
-- (initiativeId, createdAt) is a plain index, not UNIQUE.

CREATE TYPE "InitiativeHealth" AS ENUM (
  'ON_TRACK',
  'AT_RISK',
  'OFF_TRACK'
);

CREATE TABLE "initiative_updates" (
  "id"             TEXT NOT NULL,
  "initiativeId"   TEXT NOT NULL,
  "authorMemberId" TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "health"         "InitiativeHealth",
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "initiative_updates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "initiative_updates_initiativeId_createdAt_idx"
  ON "initiative_updates"("initiativeId", "createdAt");

ALTER TABLE "initiative_updates"
  ADD CONSTRAINT "initiative_updates_initiativeId_fkey"
  FOREIGN KEY ("initiativeId") REFERENCES "initiatives"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
