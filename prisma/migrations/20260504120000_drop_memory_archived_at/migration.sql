-- DropIndex
DROP INDEX "memories_projectId_archivedAt_idx";

-- AlterTable
ALTER TABLE "memories" DROP COLUMN "archivedAt";
