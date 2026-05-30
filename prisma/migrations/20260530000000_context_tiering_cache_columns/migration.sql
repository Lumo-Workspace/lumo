-- Context-injection tiering: cache columns for inline summaries / on-demand bodies
-- NOTE: IF NOT EXISTS makes this safe to re-run after the original (buggy)
-- version partially applied. Table names are the physical @@map names:
-- Task -> "tasks", Document has no @@map so it stays "Document".

-- TaskSlackContext: cached LLM summary
ALTER TABLE "task_slack_contexts" ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE "task_slack_contexts" ADD COLUMN IF NOT EXISTS "summaryGeneratedAt" TIMESTAMP(3);

-- TaskWebLink: cached fetched body
ALTER TABLE "task_web_links" ADD COLUMN IF NOT EXISTS "body" TEXT;
ALTER TABLE "task_web_links" ADD COLUMN IF NOT EXISTS "bodyFetchedAt" TIMESTAMP(3);

-- TaskArtifact: cached LLM summary
ALTER TABLE "task_artifacts" ADD COLUMN IF NOT EXISTS "summary" TEXT;

-- Document: cached LLM summary
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "summaryGeneratedAt" TIMESTAMP(3);

-- Task (physical table "tasks"): cached comments summary
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "commentsSummary" TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "commentsSummaryAt" TIMESTAMP(3);
