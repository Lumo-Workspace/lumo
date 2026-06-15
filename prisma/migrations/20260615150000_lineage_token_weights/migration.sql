-- LUM-522: token-level funnel collection (additive, nullable — no backfill)
-- Table names follow the @@map snake_case convention (lineage_edges, etc.);
-- columns are camelCase and the enum keeps its PascalCase Postgres type name,
-- mirroring 20260606120000_add_lineage_edge.
ALTER TABLE "lineage_edges" ADD COLUMN "indexTokens" INTEGER;
ALTER TABLE "lineage_edges" ADD COLUMN "fullTokens" INTEGER;
ALTER TABLE "lineage_edges" ADD COLUMN "relevanceScore" DOUBLE PRECISION;

CREATE TABLE "dropped_fragments" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sessionId" TEXT,
    "fragmentType" "LineageFragmentType" NOT NULL,
    "fragmentId" TEXT NOT NULL,
    "relevanceScore" DOUBLE PRECISION,
    "droppedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dropped_fragments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dropped_fragments_taskId_idx" ON "dropped_fragments"("taskId");
CREATE INDEX "dropped_fragments_sessionId_idx" ON "dropped_fragments"("sessionId");
CREATE INDEX "dropped_fragments_workspaceId_idx" ON "dropped_fragments"("workspaceId");

ALTER TABLE "dropped_fragments" ADD CONSTRAINT "dropped_fragments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dropped_fragments" ADD CONSTRAINT "dropped_fragments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dropped_fragments" ADD CONSTRAINT "dropped_fragments_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
