-- LUM-679 (Spec2-17): widen the Idea lifecycle from 2 → 4 states.
-- Purely ADDITIVE — two new enum values, nothing dropped or retyped, so every
-- existing `ideas` row is untouched. Removing an enum value would need a
-- destructive type-swap, which the additive-migration contract forbids; there
-- are no legacy values to retire here anyway.
--
-- The two ADD VALUEs use BEFORE/AFTER to keep the on-disk enum order aligned
-- with the schema declaration (CAPTURED, DEVELOPING, PLANNED, DROPPED) so a
-- future `prisma migrate diff` sees no drift.
ALTER TYPE "IdeaStatus" ADD VALUE 'DEVELOPING' AFTER 'CAPTURED';
ALTER TYPE "IdeaStatus" ADD VALUE 'DROPPED' AFTER 'PLANNED';
