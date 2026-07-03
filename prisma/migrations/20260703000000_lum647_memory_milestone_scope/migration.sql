-- LUM-647: MILESTONE memory scope + milestoneId pointer. Purely additive.
-- MemoryScope gains MILESTONE; memories gains a nullable milestoneId scope
-- pointer + FK (SetNull, so a deleted milestone keeps its distilled lesson) +
-- lookup index. Nothing destructive, no data migration. The new enum value is
-- never referenced in this migration (no P3009 enum-mid-migration risk).

-- AlterEnum
ALTER TYPE "MemoryScope" ADD VALUE IF NOT EXISTS 'MILESTONE';

-- AlterTable
ALTER TABLE "memories" ADD COLUMN "milestoneId" TEXT;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "memories_milestoneId_status_idx" ON "memories"("milestoneId", "status");
