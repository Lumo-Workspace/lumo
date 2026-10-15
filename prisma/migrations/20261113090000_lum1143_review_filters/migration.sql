-- LUM-1143: auto-review filters per repository. Additive:
-- every column has a default, existing rows keep today's behaviour.
ALTER TABLE "repository_review_settings"
  ADD COLUMN "baseBranches" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "ignoreTitleKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "ignoreUsernames" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "descriptionKeyword" TEXT,
  ADD COLUMN "pathFilters" TEXT[] DEFAULT ARRAY[]::TEXT[];
