-- LUM-678 (Spec2-16): reshape Initiative into a Linear-aligned, two-layer model.
-- Everything here is ADDITIVE — new enum values, new nullable/empty-table columns,
-- and one new nullable FK. No existing column or table is dropped or retyped, so
-- existing rows are untouched. The `initiatives` table is empty (never
-- materialised), which is why `name` can be added NOT NULL without a backfill.

-- AlterEnum: add the four new Linear states, preserving declared order. ACTIVE is
-- kept; DONE/DROPPED are retained-but-deprecated (removing an enum value would
-- require a destructive type-swap, which the additive-migration contract forbids).
ALTER TYPE "InitiativeStatus" ADD VALUE 'PROPOSED' BEFORE 'ACTIVE';
ALTER TYPE "InitiativeStatus" ADD VALUE 'PLANNED' BEFORE 'ACTIVE';
ALTER TYPE "InitiativeStatus" ADD VALUE 'COMPLETED' AFTER 'ACTIVE';
ALTER TYPE "InitiativeStatus" ADD VALUE 'CANCELLED' AFTER 'COMPLETED';

-- AlterTable: Linear scalar fields on Initiative (empty table → NOT NULL name is safe).
ALTER TABLE "initiatives" ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "priority" "TaskPriority",
ADD COLUMN     "ownerMemberId" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "targetDate" TIMESTAMP(3);

-- AlterTable: two-layer container — a Milestone may roll up to an Initiative.
ALTER TABLE "milestones" ADD COLUMN     "initiativeId" TEXT;

-- CreateIndex
CREATE INDEX "milestones_initiativeId_idx" ON "milestones"("initiativeId");

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "initiatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;
