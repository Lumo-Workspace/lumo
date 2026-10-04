-- LUM-959: remove the parent/child (subtask) task hierarchy.
-- DATA-DESTRUCTIVE: drops every task→parent link. Tasks themselves are kept;
-- former subtasks simply become standalone tasks. No semantic migration
-- (no auto-conversion to milestones or dependency edges) by product decision.

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_parentTaskId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "tasks_parentTaskId_idx";

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "parentTaskId";
