-- LUM-1040: remove the Ideas feature and the idea→plan converter (plan runs).
--
-- DATA-DESTRUCTIVE: permanently deletes every idea, its activity timeline,
-- evidence (Slack / web / Figma / PR citations), idea comments, every plan run
-- and its stage records, plus the tasks.ideaId / initiatives.planRunId links.
-- Initiatives and tasks themselves are kept.

-- Idea comments (and, via the parentId cascade, their replies) go first so
-- comments.taskId can become NOT NULL again.
ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_single_owner_chk";
DELETE FROM "comments" WHERE "ideaId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "ideas" DROP CONSTRAINT "ideas_teamId_fkey";

-- DropForeignKey
ALTER TABLE "ideas" DROP CONSTRAINT "ideas_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "ideas" DROP CONSTRAINT "ideas_parentId_fkey";

-- DropForeignKey
ALTER TABLE "ideas" DROP CONSTRAINT "ideas_planRunId_fkey";

-- DropForeignKey
ALTER TABLE "ideas" DROP CONSTRAINT "ideas_initiativeId_fkey";

-- DropForeignKey
ALTER TABLE "idea_activities" DROP CONSTRAINT "idea_activities_ideaId_fkey";

-- DropForeignKey
ALTER TABLE "idea_activities" DROP CONSTRAINT "idea_activities_actorId_fkey";

-- DropForeignKey
ALTER TABLE "plan_runs" DROP CONSTRAINT "plan_runs_teamId_fkey";

-- DropForeignKey
ALTER TABLE "plan_runs" DROP CONSTRAINT "plan_runs_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "plan_run_stage_records" DROP CONSTRAINT "plan_run_stage_records_planRunId_fkey";

-- DropForeignKey
ALTER TABLE "initiatives" DROP CONSTRAINT "initiatives_planRunId_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_ideaId_fkey";

-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_ideaId_fkey";

-- DropForeignKey
ALTER TABLE "idea_slack_contexts" DROP CONSTRAINT "idea_slack_contexts_ideaId_fkey";

-- DropForeignKey
ALTER TABLE "idea_slack_contexts" DROP CONSTRAINT "idea_slack_contexts_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "idea_slack_contexts" DROP CONSTRAINT "idea_slack_contexts_createdById_fkey";

-- DropForeignKey
ALTER TABLE "idea_web_links" DROP CONSTRAINT "idea_web_links_ideaId_fkey";

-- DropForeignKey
ALTER TABLE "idea_web_links" DROP CONSTRAINT "idea_web_links_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "idea_web_links" DROP CONSTRAINT "idea_web_links_createdById_fkey";

-- DropForeignKey
ALTER TABLE "idea_figma_links" DROP CONSTRAINT "idea_figma_links_ideaId_fkey";

-- DropForeignKey
ALTER TABLE "idea_figma_links" DROP CONSTRAINT "idea_figma_links_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "idea_figma_links" DROP CONSTRAINT "idea_figma_links_createdById_fkey";

-- DropForeignKey
ALTER TABLE "idea_figma_links" DROP CONSTRAINT "idea_figma_links_integrationId_fkey";

-- DropForeignKey
ALTER TABLE "idea_pull_requests" DROP CONSTRAINT "idea_pull_requests_ideaId_fkey";

-- DropForeignKey
ALTER TABLE "idea_pull_requests" DROP CONSTRAINT "idea_pull_requests_pullRequestId_fkey";

-- DropForeignKey
ALTER TABLE "idea_pull_requests" DROP CONSTRAINT "idea_pull_requests_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "idea_pull_requests" DROP CONSTRAINT "idea_pull_requests_createdById_fkey";

-- DropIndex
DROP INDEX "initiatives_planRunId_idx";

-- DropIndex
DROP INDEX "tasks_ideaId_idx";

-- DropIndex
DROP INDEX "comments_ideaId_idx";

-- AlterTable
ALTER TABLE "initiatives" DROP COLUMN "planRunId";

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "ideaId";

-- AlterTable
ALTER TABLE "comments" DROP COLUMN "ideaId",
ALTER COLUMN "taskId" SET NOT NULL;

-- DropTable
DROP TABLE "ideas";

-- DropTable
DROP TABLE "idea_activities";

-- DropTable
DROP TABLE "plan_runs";

-- DropTable
DROP TABLE "plan_run_stage_records";

-- DropTable
DROP TABLE "idea_slack_contexts";

-- DropTable
DROP TABLE "idea_web_links";

-- DropTable
DROP TABLE "idea_figma_links";

-- DropTable
DROP TABLE "idea_pull_requests";

-- DropEnum
DROP TYPE "IdeaStatus";

-- DropEnum
DROP TYPE "IdeaActivityType";

-- DropEnum
DROP TYPE "PlanRunStage";

-- DropEnum
DROP TYPE "PlanStageKind";

