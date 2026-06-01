-- Per-project lease serializing Layer 2 memory consolidation (see layer2.service).
-- AlterTable
ALTER TABLE "projects" ADD COLUMN "memoryConsolidationLockedUntil" TIMESTAMP(3);
