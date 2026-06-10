-- LUM-400: Task.repositoryId had no business consumers (PR-task association is
-- branch-name / URL based and never read it). Data-destructive: discards the
-- manually-annotated task -> repository links.

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_repositoryId_fkey";

-- DropIndex
DROP INDEX "tasks_repositoryId_idx";

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "repositoryId";
