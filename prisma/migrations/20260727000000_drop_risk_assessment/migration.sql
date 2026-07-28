-- LUM-709: the risk-assessment feature is removed. Drops the workspace-level
-- risk thresholds and the per-project overrides that tuned them.
--
-- DESTRUCTIVE: any thresholds a workspace or project had customised are lost.
-- Nothing reads these columns after this migration — scoring, the settings
-- form, the project override card and the risk badges are all gone.

ALTER TABLE "Workspace" DROP COLUMN "riskOverdueRatio";
ALTER TABLE "Workspace" DROP COLUMN "riskStalledDays";
ALTER TABLE "Workspace" DROP COLUMN "riskStalledMinCount";
ALTER TABLE "Workspace" DROP COLUMN "riskAgentFailRatio";
ALTER TABLE "Workspace" DROP COLUMN "riskStalePrDays";
ALTER TABLE "Workspace" DROP COLUMN "riskThroughputDrop";

ALTER TABLE "Project" DROP COLUMN "riskOverdueRatio";
ALTER TABLE "Project" DROP COLUMN "riskStalledDays";
ALTER TABLE "Project" DROP COLUMN "riskStalledMinCount";
ALTER TABLE "Project" DROP COLUMN "riskAgentFailRatio";
ALTER TABLE "Project" DROP COLUMN "riskStalePrDays";
ALTER TABLE "Project" DROP COLUMN "riskThroughputDrop";
