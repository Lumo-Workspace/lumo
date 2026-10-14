-- LUM-1134: the PR reviewer's learnings scope, per workspace (CodeRabbit's
-- `knowledge_base.learnings.scope`: local | global | auto). Additive only: one
-- NOT NULL text column with a constant default (metadata-only in Postgres
-- 11+). Default 'auto' — a private repository's review now also reads the
-- workspace's other repositories' learnings; a public one (or one whose
-- visibility cannot be read) keeps today's same-repository behaviour.
ALTER TABLE "workspaces" ADD COLUMN "securityLearningsScope" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_securityLearningsScope_check" CHECK ("securityLearningsScope" IN ('local', 'global', 'auto'));
