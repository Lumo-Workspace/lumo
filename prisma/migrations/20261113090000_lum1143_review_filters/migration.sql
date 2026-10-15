-- LUM-1143: auto-review filters per repository. Additive: every column has a
-- default; nothing is dropped or deleted.
ALTER TABLE "repository_review_settings"
  ADD COLUMN "baseBranches" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "emptyBaseBranchesMeans" TEXT NOT NULL DEFAULT 'default_branch_only',
  ADD COLUMN "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "ignoreTitleKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "ignoreUsernames" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "descriptionKeyword" TEXT,
  ADD COLUMN "pathFilters" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- User decision (2026-10-15): repositories connected before this release keep
-- reviewing PRs into every base branch; only newly connected repositories get
-- "default branch only" for an empty base-branch list.
-- 1. Existing setting rows.
UPDATE "repository_review_settings" SET "emptyBaseBranchesMeans" = 'all_branches';

-- 2. Every repository a workspace has confirmed but never configured (no row
--    yet = defaults): store a row so it keeps "all branches" too. Names are
--    stored lower-cased, as the application does.
INSERT INTO "repository_review_settings"
  ("id", "workspaceId", "repo", "emptyBaseBranchesMeans", "createdAt", "updatedAt")
SELECT
  'lum1143_' || md5(c."workspaceId" || '/' || c."repo"),
  c."workspaceId",
  c."repo",
  'all_branches',
  NOW(),
  NOW()
FROM (
  SELECT DISTINCT i."workspaceId", lower(r) AS "repo"
  FROM "github_app_installations" i, unnest(i."repositories") AS r
) c
ON CONFLICT ("workspaceId", "repo") DO NOTHING;
