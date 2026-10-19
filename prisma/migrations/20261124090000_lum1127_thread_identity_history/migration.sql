-- LUM-1127 follow-up #4: the union of identities a PR finding thread has
-- carried (hashes only). Additive; existing rows start empty and are seeded
-- from their current identity on the next sync.
ALTER TABLE "pr_finding_threads" ADD COLUMN "identityHistory" JSONB NOT NULL DEFAULT '[]';
