-- LUM-397: strong/weak outcome stratification + memory birth-task accounting.
-- Purely additive — two nullable columns, no drops, no data rewrites.

-- AlterTable: MERGED strength (true = task had an all-PASS verification round)
ALTER TABLE "lineage_edges" ADD COLUMN "outcomeVerified" BOOLEAN;

-- AlterTable: birth task captured at extraction-write time (no backfill)
ALTER TABLE "memories" ADD COLUMN "sourceTaskId" TEXT;
