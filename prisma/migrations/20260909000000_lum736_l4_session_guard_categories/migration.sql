-- LUM-736 (Security Scan v2, L4 Session Guard): extend BoundaryCrossingCategory
-- with three deterministic session-guard classes. Purely additive enum
-- extension. Postgres cannot use a freshly added enum value inside the same
-- transaction that adds it, so this migration ONLY adds the values; the app
-- code that writes them ships separately (the two-step rule).

-- AlterEnum
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'SENSITIVE_PATH_EDIT';
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'HOOK_BYPASS';
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'TEST_FILE_DELETED';
