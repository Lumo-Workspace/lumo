-- LUM-547 (P4b): code-anchor staleness reports. Purely additive — a new table,
-- no changes to existing tables, no data destruction.

-- CreateTable
CREATE TABLE "memory_stale_anchor_reports" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "deadAnchors" JSONB NOT NULL,
    "reportedBySession" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_stale_anchor_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "memory_stale_anchor_reports_memoryId_key" ON "memory_stale_anchor_reports"("memoryId");

-- CreateIndex
CREATE INDEX "memory_stale_anchor_reports_projectId_idx" ON "memory_stale_anchor_reports"("projectId");
