-- Drop the previous text-based summary columns and recreate the summary
-- surface as a two-step (classify + generate) structured payload. The existing
-- `summary` column held markdown; the new Json column stores a type-specific
-- shape, so the two representations are not compatible — dropping is
-- intentional per product decision.

-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "summary";
ALTER TABLE "sessions" DROP COLUMN "summaryModel";

ALTER TABLE "sessions" ADD COLUMN     "summary" JSONB,
ADD COLUMN     "summaryType" TEXT,
ADD COLUMN     "summaryClassifyModel" TEXT,
ADD COLUMN     "summaryContentModel" TEXT,
ADD COLUMN     "summaryEventCount" INTEGER;
