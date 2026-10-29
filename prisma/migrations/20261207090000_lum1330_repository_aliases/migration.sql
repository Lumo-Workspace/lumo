-- LUM-1330: remember renamed repositories (old owner/name -> new name) per
-- workspace, so a CLI whose git remote still has the old name finds them.
-- Additive: existing rows start with an empty record.
ALTER TABLE "github_app_installations" ADD COLUMN "repositoryAliases" JSONB NOT NULL DEFAULT '{}';
