-- LUM-325: memory lifecycle (status enum + bi-temporal fields, invalidate-not-delete).
--
-- SUPERSEDE stops overwriting rows in place. The old row is kept (status =
-- 'SUPERSEDED', content preserved for audit + flywheel lineage) and the new
-- content lands on a fresh ACTIVE row; a MemoryProvenance edge rolls old→new so
-- resolveCanonicalFragment keeps lineage joined. Only ACTIVE rows are injected /
-- reconciled. ARCHIVED is reserved for cold eviction (LUM-328), unused here.
--
-- PROD: requires `prisma migrate deploy` on the next deploy. Additive only — no
-- data deletion. Independent of the LUM-324 embedding migration (different
-- columns); deploy order between the two does not matter.

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'ARCHIVED');

-- DropIndex
DROP INDEX "memories_projectId_scope_idx";

-- DropIndex
DROP INDEX "memories_taskId_idx";

-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "status" "MemoryStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "supersededById" TEXT,
ADD COLUMN     "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: existing rows became the live truth when they were created, not at
-- migration time. (New rows keep the CURRENT_TIMESTAMP default.)
UPDATE "memories" SET "validFrom" = "createdAt";

-- CreateIndex
CREATE INDEX "memories_projectId_scope_status_idx" ON "memories"("projectId", "scope", "status");

-- CreateIndex
CREATE INDEX "memories_taskId_status_idx" ON "memories"("taskId", "status");
