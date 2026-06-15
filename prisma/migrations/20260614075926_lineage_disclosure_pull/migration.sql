-- CreateEnum
CREATE TYPE "LineageDisclosure" AS ENUM ('FULL', 'INDEX');

-- AlterTable
ALTER TABLE "lineage_edges" ADD COLUMN "disclosure" "LineageDisclosure" NOT NULL DEFAULT 'FULL';
ALTER TABLE "lineage_edges" ADD COLUMN "pulledAt" TIMESTAMP(3);
