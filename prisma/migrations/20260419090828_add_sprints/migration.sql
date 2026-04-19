-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SPRINT_STARTED';
ALTER TYPE "NotificationType" ADD VALUE 'SPRINT_CLOSED';

-- AlterEnum
ALTER TYPE "TaskActivityType" ADD VALUE 'SPRINT_CHANGED';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "sprintId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "sprintId" TEXT;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "sprintAutoPrepare" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sprintCadenceDays" INTEGER;

-- CreateTable
CREATE TABLE "sprints" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SprintStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprint_summaries" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "tldr" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sprint_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sprints_teamId_status_idx" ON "sprints"("teamId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sprints_teamId_number_key" ON "sprints"("teamId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sprint_summaries_sprintId_key" ON "sprint_summaries"("sprintId");

-- CreateIndex
CREATE INDEX "tasks_sprintId_idx" ON "tasks"("sprintId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_summaries" ADD CONSTRAINT "sprint_summaries_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ensure at most one ACTIVE sprint per team (partial unique index — not expressible in Prisma schema).
CREATE UNIQUE INDEX "sprints_team_active"
  ON "sprints"("teamId")
  WHERE status = 'ACTIVE';
