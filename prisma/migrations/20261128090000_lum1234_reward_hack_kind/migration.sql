-- LUM-1234: reward-hack finding kind. ADD VALUE alone in its own migration
-- (PG forbids using a freshly added enum value in the same transaction).
ALTER TYPE "PrSecurityFindingKind" ADD VALUE IF NOT EXISTS 'REWARD_HACK';
