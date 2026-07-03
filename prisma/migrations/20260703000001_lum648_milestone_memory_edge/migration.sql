-- LUM-648: cross-milestone learning-migration usage edge. Purely additive —
-- one new table + indexes + FKs, no data migration, nothing destructive.
-- Records the used=true/false/null usage-vote substrate for MILESTONE-scope
-- memories (LUM-647) injected into later milestones' steward sessions; the
-- task-flywheel LineageEdge can't carry these (its taskId is non-null).

-- CreateTable
CREATE TABLE "milestone_memory_edges" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "sourceMilestoneId" TEXT,
    "consumerMilestoneId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "injectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used" BOOLEAN,
    "usedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestone_memory_edges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestone_memory_edges_consumerMilestoneId_idx" ON "milestone_memory_edges"("consumerMilestoneId");

-- CreateIndex
CREATE INDEX "milestone_memory_edges_memoryId_idx" ON "milestone_memory_edges"("memoryId");

-- CreateIndex
CREATE INDEX "milestone_memory_edges_workspaceId_idx" ON "milestone_memory_edges"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_memory_edges_sessionId_memoryId_key" ON "milestone_memory_edges"("sessionId", "memoryId");

-- AddForeignKey
ALTER TABLE "milestone_memory_edges" ADD CONSTRAINT "milestone_memory_edges_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_memory_edges" ADD CONSTRAINT "milestone_memory_edges_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_memory_edges" ADD CONSTRAINT "milestone_memory_edges_sourceMilestoneId_fkey" FOREIGN KEY ("sourceMilestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_memory_edges" ADD CONSTRAINT "milestone_memory_edges_consumerMilestoneId_fkey" FOREIGN KEY ("consumerMilestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_memory_edges" ADD CONSTRAINT "milestone_memory_edges_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
