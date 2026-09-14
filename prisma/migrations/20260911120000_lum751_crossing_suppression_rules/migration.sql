-- LUM-751 (Security Scan v2): repository-level false-positive rules.
-- Purely additive: one enum value, one table, one nullable column + index.
-- Postgres cannot use a freshly added enum value in the same transaction that
-- adds it, so this migration only ADDS the value; app code writes it.

-- AlterEnum
ALTER TYPE "BoundaryCrossingDisposition" ADD VALUE IF NOT EXISTS 'AUTO_SUPPRESSED';

-- CreateTable
CREATE TABLE "crossing_suppression_rules" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" "BoundaryCrossingCategory" NOT NULL,
    "targetPattern" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "sourceCrossingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "crossing_suppression_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crossing_suppression_rules_projectId_category_idx" ON "crossing_suppression_rules"("projectId", "category");

-- AddForeignKey
ALTER TABLE "crossing_suppression_rules" ADD CONSTRAINT "crossing_suppression_rules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "boundary_crossings" ADD COLUMN "suppressionRuleId" TEXT;

-- CreateIndex
CREATE INDEX "boundary_crossings_suppressionRuleId_idx" ON "boundary_crossings"("suppressionRuleId");

-- AddForeignKey
ALTER TABLE "boundary_crossings" ADD CONSTRAINT "boundary_crossings_suppressionRuleId_fkey" FOREIGN KEY ("suppressionRuleId") REFERENCES "crossing_suppression_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
