-- LUM-478: system 'auto-legit' disposition for deterministic high-confidence
-- legit TEST_TAMPERING edits. Additive enum value — no data migration, no
-- destructive change. A crossing carrying this disposition is on record but
-- resolved out of the open queue and non-DONE-blocking, distinguishable from a
-- human FALSE_POSITIVE by both the value and a null dispositionedById.
ALTER TYPE "BoundaryCrossingDisposition" ADD VALUE IF NOT EXISTS 'AUTO_LEGIT';
