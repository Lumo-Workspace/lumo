-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "agentChangedFiles" JSONB,
ADD COLUMN     "agentDurationMs" INTEGER,
ADD COLUMN     "agentSummary" TEXT;
