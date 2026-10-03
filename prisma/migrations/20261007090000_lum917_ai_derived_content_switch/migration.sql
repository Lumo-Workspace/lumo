-- LUM-917: workspace switch for AI-derived content (memory extraction,
-- session summaries, run summaries). Additive only: every existing and new
-- workspace keeps generating (default true). No data is changed or deleted.
ALTER TABLE "workspaces" ADD COLUMN "aiDerivedContentEnabled" BOOLEAN NOT NULL DEFAULT true;

-- LUM-917: the OWNER's batched delete of a workspace's memories selects by
-- workspaceId; memories had no index leading with it.
CREATE INDEX "memories_workspaceId_idx" ON "memories"("workspaceId");
