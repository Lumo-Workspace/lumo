-- LUM-1142: CodeRabbit's `reviews.allow_author_approval`, per workspace.
-- Additive only: one NOT NULL boolean with a constant default (metadata-only
-- in Postgres 11+). Default true — every existing workspace gets CodeRabbit's
-- default: the PR's author may `@uselumo resolve` / `approve` their own PR.
ALTER TABLE "workspaces" ADD COLUMN "securityAllowAuthorApproval" BOOLEAN NOT NULL DEFAULT true;
