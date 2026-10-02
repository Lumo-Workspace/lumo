-- LUM-932 P2: per-event identification signals (derived column) and the
-- attribution segment table (shadow mode — nothing reads it for gating yet).
-- Additive only.
ALTER TABLE "hook_events" ADD COLUMN "attributionSignals" JSONB;

CREATE TYPE "AttributionSource" AS ENUM ('SESSION_ATTACH', 'SUBAGENT_ATTACH', 'INHERITED', 'INFERRED');
CREATE TYPE "AttributionConfidence" AS ENUM ('EXPLICIT', 'HIGH', 'MEDIUM');

CREATE TABLE "task_attribution_segments" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromTurn" INTEGER NOT NULL,
    "toTurn" INTEGER NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3),
    "source" "AttributionSource" NOT NULL,
    "confidence" "AttributionConfidence" NOT NULL,
    "evidence" JSONB NOT NULL,
    "computeVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_attribution_segments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_attribution_segments_sessionId_idx" ON "task_attribution_segments"("sessionId");
CREATE INDEX "task_attribution_segments_taskId_idx" ON "task_attribution_segments"("taskId");
CREATE INDEX "task_attribution_segments_workspaceId_idx" ON "task_attribution_segments"("workspaceId");

ALTER TABLE "task_attribution_segments" ADD CONSTRAINT "task_attribution_segments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_attribution_segments" ADD CONSTRAINT "task_attribution_segments_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_attribution_segments" ADD CONSTRAINT "task_attribution_segments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
