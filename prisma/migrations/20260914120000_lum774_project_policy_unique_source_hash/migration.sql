-- LUM-774: policy recompiles are single-flight per (projectId, sourceHash).
--
-- After the LUM-772 compiler-version bump, PostToolUse hooks from parallel
-- Claude Code sessions recompiled one unchanged CLAUDE.md three times in 41 s:
-- three project_policies rows with an identical sourceHash (14 / 28 / 23 rules
-- — model nondeterminism) and three POLICY_WEAKENING crossings, each diffing
-- against the same pre-bump row. The service now persists with
-- ON CONFLICT DO NOTHING against the unique key below; the losing compile
-- serves the winner's row and emits nothing.
--
-- DATA STEP (deletes rows): a unique index cannot be created while duplicate
-- keys exist, so every duplicate (projectId, sourceHash) group is collapsed to
-- its NEWEST row first (highest compiledAt; ties broken by id). The newest row
-- is exactly the one `latestForProject` already served, so the active policy
-- of every project is unchanged. On production this removes the 2 older rows
-- of project cmn32e31r000004lazy8geebi (hash e7af14ee23c5…, 14- and 28-rule
-- snapshots) and keeps the 23-rule row.
DELETE FROM "project_policies" AS older
USING "project_policies" AS newer
WHERE older."projectId" = newer."projectId"
  AND older."sourceHash" = newer."sourceHash"
  AND (
    older."compiledAt" < newer."compiledAt"
    OR (older."compiledAt" = newer."compiledAt" AND older."id" < newer."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "project_policies_projectId_sourceHash_key" ON "project_policies"("projectId", "sourceHash");
