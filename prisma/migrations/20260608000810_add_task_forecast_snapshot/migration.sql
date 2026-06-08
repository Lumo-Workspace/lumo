-- CreateTable: TaskForecastSnapshot (LUM-319)
CREATE TABLE "task_forecast_snapshots" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "iterations" JSONB,
  "clarifyRounds" JSONB,
  "tokenCost" JSONB,
  "cohortSize" INTEGER NOT NULL,
  "tokenCostBasis" INTEGER NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_forecast_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_forecast_snapshots_taskId_key" ON "task_forecast_snapshots"("taskId");
ALTER TABLE "task_forecast_snapshots" ADD CONSTRAINT "task_forecast_snapshots_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
