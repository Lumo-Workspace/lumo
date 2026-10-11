-- LUM-1083: remove the Initiative feature.
-- DATA-DESTRUCTIVE: drops every initiative and initiative progress update, and
-- the nullable initiativeId roll-up on tasks and milestones. Tasks and
-- milestones themselves are untouched.

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_initiativeId_fkey";
ALTER TABLE "milestones" DROP CONSTRAINT "milestones_initiativeId_fkey";

-- DropIndex
DROP INDEX "tasks_initiativeId_idx";
DROP INDEX "milestones_initiativeId_idx";

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "initiativeId";
ALTER TABLE "milestones" DROP COLUMN "initiativeId";

-- DropTable (initiative_updates first: it references initiatives)
DROP TABLE "initiative_updates";
DROP TABLE "initiatives";

-- DropEnum
DROP TYPE "InitiativeHealth";
DROP TYPE "InitiativeStatus";
