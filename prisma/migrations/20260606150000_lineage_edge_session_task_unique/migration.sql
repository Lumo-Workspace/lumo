-- CreateIndex
CREATE UNIQUE INDEX "lineage_edges_sessionId_taskId_fragmentType_fragmentId_key" ON "lineage_edges"("sessionId", "taskId", "fragmentType", "fragmentId");
