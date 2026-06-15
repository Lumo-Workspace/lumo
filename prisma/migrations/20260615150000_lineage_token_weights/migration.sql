-- LUM-522: token-level funnel collection (additive, nullable — no backfill)
ALTER TABLE "LineageEdge" ADD COLUMN "indexTokens" INTEGER;
ALTER TABLE "LineageEdge" ADD COLUMN "fullTokens" INTEGER;
ALTER TABLE "LineageEdge" ADD COLUMN "relevanceScore" DOUBLE PRECISION;

CREATE TABLE "DroppedFragment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sessionId" TEXT,
    "fragmentType" "LineageFragmentType" NOT NULL,
    "fragmentId" TEXT NOT NULL,
    "relevanceScore" DOUBLE PRECISION,
    "droppedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DroppedFragment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DroppedFragment_taskId_idx" ON "DroppedFragment"("taskId");
CREATE INDEX "DroppedFragment_sessionId_idx" ON "DroppedFragment"("sessionId");
CREATE INDEX "DroppedFragment_workspaceId_idx" ON "DroppedFragment"("workspaceId");

ALTER TABLE "DroppedFragment" ADD CONSTRAINT "DroppedFragment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DroppedFragment" ADD CONSTRAINT "DroppedFragment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DroppedFragment" ADD CONSTRAINT "DroppedFragment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
