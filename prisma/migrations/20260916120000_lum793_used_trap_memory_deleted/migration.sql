-- LUM-793: USED_TRAP_MEMORY_DELETED — a new BoundaryCrossingCategory for an
-- agent hard-deleting a TRAP memory that had already been judged *used* on at
-- least one other task. Purely additive enum extension; no table or data
-- change. Postgres cannot use a freshly added enum value inside the same
-- transaction that adds it, so this migration ONLY adds the value.

-- AlterEnum
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'USED_TRAP_MEMORY_DELETED';
