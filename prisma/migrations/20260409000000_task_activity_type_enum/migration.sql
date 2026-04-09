-- CreateEnum
CREATE TYPE "TaskActivityType" AS ENUM ('TASK_CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNEE_CHANGED', 'REVIEWER_CHANGED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED', 'DUE_DATE_CHANGED', 'PARENT_CHANGED', 'TAGS_CHANGED', 'REPOSITORY_CHANGED', 'COMMENT_ADDED', 'COMMENT_DELETED', 'SUBTASK_ADDED', 'SUBTASK_REMOVED', 'SPEC_GENERATED', 'BRANCH_CREATED', 'PR_LINKED', 'PR_UNLINKED', 'PR_CREATED', 'PR_MERGED', 'AGENT_RUN_STARTED', 'AGENT_RUN_COMPLETED', 'AGENT_RUN_FAILED', 'AGENT_INPUT_REQUIRED');

-- Convert existing string values to uppercase to match enum values
UPDATE "task_activities" SET "type" = UPPER(REPLACE("type", ' ', '_')) WHERE "type" IS NOT NULL;

-- AlterTable: change type column from String to TaskActivityType enum
ALTER TABLE "task_activities" ALTER COLUMN "type" TYPE "TaskActivityType" USING "type"::"TaskActivityType";

-- CreateIndex
CREATE INDEX "task_activities_taskId_createdAt_idx" ON "task_activities"("taskId", "createdAt");
