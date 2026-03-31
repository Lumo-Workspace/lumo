-- AlterTable: add sandboxId to agent_runs
ALTER TABLE "agent_runs" ADD COLUMN "sandboxId" TEXT;

-- AlterTable: drop sandboxId from tasks
ALTER TABLE "tasks" DROP COLUMN "sandboxId";
