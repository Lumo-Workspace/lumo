-- Drop historical REVIEWER_CHANGED activity rows before the enum value is removed.
DELETE FROM "task_activities" WHERE "type" = 'REVIEWER_CHANGED';

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_reviewerActorId_fkey";

-- DropIndex
DROP INDEX "tasks_reviewerActorId_idx";

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "reviewerActorId";

-- AlterEnum
BEGIN;
CREATE TYPE "TaskActivityType_new" AS ENUM ('TASK_CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNEE_CHANGED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED', 'DUE_DATE_CHANGED', 'PARENT_CHANGED', 'TAGS_CHANGED', 'REPOSITORY_CHANGED', 'COMMENT_ADDED', 'COMMENT_DELETED', 'SUBTASK_ADDED', 'SUBTASK_REMOVED', 'SPEC_GENERATED', 'BRANCH_CREATED', 'PR_LINKED', 'PR_UNLINKED', 'PR_CREATED', 'PR_MERGED', 'AGENT_RUN_STARTED', 'AGENT_RUN_COMPLETED', 'AGENT_RUN_FAILED', 'AGENT_INPUT_REQUIRED', 'SENTRY_ALERT', 'SPRINT_CHANGED');
ALTER TABLE "task_activities" ALTER COLUMN "type" TYPE "TaskActivityType_new" USING ("type"::text::"TaskActivityType_new");
ALTER TYPE "TaskActivityType" RENAME TO "TaskActivityType_old";
ALTER TYPE "TaskActivityType_new" RENAME TO "TaskActivityType";
DROP TYPE "TaskActivityType_old";
COMMIT;
