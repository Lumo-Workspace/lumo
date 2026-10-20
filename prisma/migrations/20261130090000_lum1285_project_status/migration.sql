-- LUM-1285: project status (human ruling), optional dates and an archive flag.
-- Additive only: one new enum type and four new columns. Every existing
-- project becomes ACTIVE, undated and unarchived; nothing is deleted.

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELED');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "targetDate" TIMESTAMP(3),
ADD COLUMN     "archivedAt" TIMESTAMP(3);
