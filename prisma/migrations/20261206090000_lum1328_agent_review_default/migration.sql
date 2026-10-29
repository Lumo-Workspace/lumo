-- LUM-1328: the developer's own agent review becomes the default.
-- 1. New workspaces start with Lumo's AI review and hunt off. Column
--    defaults only: existing workspaces keep their stored values.
ALTER TABLE "workspaces" ALTER COLUMN "securityAiReviewEnabled" SET DEFAULT false;
ALTER TABLE "workspaces" ALTER COLUMN "securityHuntEnabled" SET DEFAULT false;

-- 2. Which agent reviews (`lumo security import`) were imported into a scan,
--    so a clean import is told apart from none. Additive, no data change.
ALTER TABLE "pr_security_scans" ADD COLUMN "agentReviewTools" TEXT[] DEFAULT ARRAY[]::TEXT[];
