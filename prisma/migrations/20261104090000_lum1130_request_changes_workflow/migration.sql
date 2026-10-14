-- LUM-1130: the PR reviewer's request-changes workflow, per workspace.
-- Additive only: one NOT NULL boolean with a constant default (metadata-only
-- in Postgres 11+). Default false — every existing workspace keeps getting
-- COMMENT-only reviews until an owner turns the workflow on.
ALTER TABLE "workspaces" ADD COLUMN "securityRequestChangesEnabled" BOOLEAN NOT NULL DEFAULT false;
