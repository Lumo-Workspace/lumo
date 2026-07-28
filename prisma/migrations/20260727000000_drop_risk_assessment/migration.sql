-- LUM-709: the risk-assessment feature is removed. Drops the workspace-level
-- risk thresholds and the per-project overrides that tuned them.
--
-- DESTRUCTIVE: any thresholds a workspace or project had customised are lost.
-- Nothing reads these columns after this migration — scoring, the settings
-- form, the project override card and the risk badges are all gone.
--
-- Table names are the PHYSICAL ones (`workspaces` / `projects`, via @@map),
-- not the Prisma model names. The first cut of this file used "Workspace" /
-- "Project" and failed the production deploy with 42P01 (relation does not
-- exist), which left the migration recorded as failed and blocked every
-- subsequent deploy. Mirrors 20260411000000 / 20260411000100, which added
-- these columns under the same physical names.

ALTER TABLE "workspaces" DROP COLUMN "riskOverdueRatio";
ALTER TABLE "workspaces" DROP COLUMN "riskStalledDays";
ALTER TABLE "workspaces" DROP COLUMN "riskStalledMinCount";
ALTER TABLE "workspaces" DROP COLUMN "riskAgentFailRatio";
ALTER TABLE "workspaces" DROP COLUMN "riskStalePrDays";
ALTER TABLE "workspaces" DROP COLUMN "riskThroughputDrop";

ALTER TABLE "projects" DROP COLUMN "riskOverdueRatio";
ALTER TABLE "projects" DROP COLUMN "riskStalledDays";
ALTER TABLE "projects" DROP COLUMN "riskStalledMinCount";
ALTER TABLE "projects" DROP COLUMN "riskAgentFailRatio";
ALTER TABLE "projects" DROP COLUMN "riskStalePrDays";
ALTER TABLE "projects" DROP COLUMN "riskThroughputDrop";
