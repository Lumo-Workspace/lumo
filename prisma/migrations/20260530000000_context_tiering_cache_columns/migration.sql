-- Context-injection tiering: cache columns for inline summaries / on-demand bodies

-- TaskSlackContext: cached LLM summary
ALTER TABLE "task_slack_contexts" ADD COLUMN "summary" TEXT;
ALTER TABLE "task_slack_contexts" ADD COLUMN "summaryGeneratedAt" TIMESTAMP(3);

-- TaskWebLink: cached fetched body
ALTER TABLE "task_web_links" ADD COLUMN "body" TEXT;
ALTER TABLE "task_web_links" ADD COLUMN "bodyFetchedAt" TIMESTAMP(3);

-- TaskArtifact: cached LLM summary
ALTER TABLE "task_artifacts" ADD COLUMN "summary" TEXT;

-- Document: cached LLM summary
ALTER TABLE "Document" ADD COLUMN "summary" TEXT;
ALTER TABLE "Document" ADD COLUMN "summaryGeneratedAt" TIMESTAMP(3);

-- Task: cached comments summary
ALTER TABLE "Task" ADD COLUMN "commentsSummary" TEXT;
ALTER TABLE "Task" ADD COLUMN "commentsSummaryAt" TIMESTAMP(3);
