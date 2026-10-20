-- LUM-1282: CANCELED task status + DUPLICATES dependency kind. ADD VALUE alone
-- in its own migration (PG forbids using a freshly added enum value in the
-- same transaction); nothing in this migration reads or writes them.
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'CANCELED';
ALTER TYPE "DependencyKind" ADD VALUE IF NOT EXISTS 'DUPLICATES';
