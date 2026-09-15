-- LUM-750: (1) SELF_DISPOSITION — a new BoundaryCrossingCategory for an
-- agent-issued `lumo crossing disposition` / `lumo finding disposition`
-- (HIGH, irreversible; the referenced CLI-channel disposition is rolled back
-- to OPEN). (2) SECURITY_FINDING_DISPOSITIONED — a new TaskActivityType for
-- the append-only audit trail of CLI-channel finding rulings and their
-- SYSTEM rollbacks. Purely additive enum extensions; no table or data change.
-- Postgres cannot use a freshly added enum value inside the same transaction
-- that adds it, so this migration ONLY adds the values (the two-step rule).

-- AlterEnum
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'SELF_DISPOSITION';

-- AlterEnum
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'SECURITY_FINDING_DISPOSITIONED';
