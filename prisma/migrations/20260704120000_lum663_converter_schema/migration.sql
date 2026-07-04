-- CreateEnum
CREATE TYPE "SizeHint" AS ENUM ('S', 'M', 'L');

-- CreateEnum
CREATE TYPE "PlanRunStage" AS ENUM ('CLUSTERING', 'CLUSTERS_READY', 'ALIGNING', 'ALIGNMENT_READY', 'GENERATING', 'DRAFT_READY', 'MATERIALIZED', 'ABANDONED', 'FAILED');

-- CreateEnum
CREATE TYPE "PlanStageKind" AS ENUM ('CLUSTER', 'ALIGN', 'GENERATE');

-- CreateEnum
CREATE TYPE "InitiativeStatus" AS ENUM ('ACTIVE', 'DONE', 'DROPPED');

-- AlterTable
ALTER TABLE "ideas" ADD COLUMN     "initiativeId" TEXT,
ADD COLUMN     "planRunId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "ideaId" TEXT,
ADD COLUMN     "initiativeId" TEXT,
ADD COLUMN     "sizeHint" "SizeHint";

-- CreateTable
CREATE TABLE "plan_runs" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stage" "PlanRunStage" NOT NULL DEFAULT 'CLUSTERING',
    "startedByMemberId" TEXT NOT NULL,
    "inputIdeaIds" TEXT[],
    "priorityId" TEXT,
    "prioritySnapshot" TEXT,
    "proseDocument" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_run_stage_records" (
    "id" TEXT NOT NULL,
    "planRunId" TEXT NOT NULL,
    "kind" "PlanStageKind" NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "llmInput" TEXT NOT NULL,
    "llmRawOutput" JSONB NOT NULL,
    "humanConfirmedOutput" JSONB,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_run_stage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initiatives" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "planRunId" TEXT,
    "goalStatement" TEXT NOT NULL,
    "assumptionNote" TEXT,
    "status" "InitiativeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "initiatives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_runs_teamId_stage_idx" ON "plan_runs"("teamId", "stage");

-- CreateIndex
CREATE INDEX "plan_runs_workspaceId_idx" ON "plan_runs"("workspaceId");

-- CreateIndex
CREATE INDEX "plan_run_stage_records_planRunId_idx" ON "plan_run_stage_records"("planRunId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_run_stage_records_planRunId_kind_key" ON "plan_run_stage_records"("planRunId", "kind");

-- CreateIndex
CREATE INDEX "initiatives_teamId_status_idx" ON "initiatives"("teamId", "status");

-- CreateIndex
CREATE INDEX "initiatives_workspaceId_idx" ON "initiatives"("workspaceId");

-- CreateIndex
CREATE INDEX "initiatives_planRunId_idx" ON "initiatives"("planRunId");

-- CreateIndex
CREATE UNIQUE INDEX "initiatives_teamId_number_key" ON "initiatives"("teamId", "number");

-- CreateIndex
CREATE INDEX "ideas_planRunId_idx" ON "ideas"("planRunId");

-- CreateIndex
CREATE INDEX "ideas_initiativeId_idx" ON "ideas"("initiativeId");

-- CreateIndex
CREATE INDEX "tasks_initiativeId_idx" ON "tasks"("initiativeId");

-- CreateIndex
CREATE INDEX "tasks_ideaId_idx" ON "tasks"("ideaId");

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_planRunId_fkey" FOREIGN KEY ("planRunId") REFERENCES "plan_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "initiatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_runs" ADD CONSTRAINT "plan_runs_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_runs" ADD CONSTRAINT "plan_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_run_stage_records" ADD CONSTRAINT "plan_run_stage_records_planRunId_fkey" FOREIGN KEY ("planRunId") REFERENCES "plan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_planRunId_fkey" FOREIGN KEY ("planRunId") REFERENCES "plan_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "initiatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

