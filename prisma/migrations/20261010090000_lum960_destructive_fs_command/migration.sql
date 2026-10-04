-- LUM-960: DESTRUCTIVE_FS_COMMAND — a new BoundaryCrossingCategory for a local
-- filesystem command that destroys state outside the repository (recursive rm /
-- find -delete on a root-level path, shred, mkfs, dd onto a device). Purely
-- additive enum extension; no table or data change. Postgres cannot use a
-- freshly added enum value inside the same transaction that adds it, so this
-- migration ONLY adds the value.

-- AlterEnum
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'DESTRUCTIVE_FS_COMMAND';
