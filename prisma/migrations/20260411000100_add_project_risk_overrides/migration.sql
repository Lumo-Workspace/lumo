ALTER TABLE "projects" ADD COLUMN "riskOverdueRatio"    DOUBLE PRECISION;
ALTER TABLE "projects" ADD COLUMN "riskStalledDays"     INTEGER;
ALTER TABLE "projects" ADD COLUMN "riskStalledMinCount" INTEGER;
ALTER TABLE "projects" ADD COLUMN "riskAgentFailRatio"  DOUBLE PRECISION;
ALTER TABLE "projects" ADD COLUMN "riskStalePrDays"     INTEGER;
ALTER TABLE "projects" ADD COLUMN "riskThroughputDrop"  DOUBLE PRECISION;
