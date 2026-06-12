-- LUM-441: reward-hacking (TEST_TAMPERING) boundary-crossing category.
-- Additive enum value — no data migration, no destructive change.
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'TEST_TAMPERING';
