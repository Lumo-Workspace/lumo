-- LUM-963: extend BoundaryCrossingCategory with SENSITIVE_PATH_READ (reading a
-- credential store outside the repo — LOW, always advisory, never blocks DONE).
-- Purely additive. Postgres cannot use a freshly added enum value inside the
-- same transaction that adds it, so this migration ONLY adds the value.

-- AlterEnum
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'SENSITIVE_PATH_READ';
