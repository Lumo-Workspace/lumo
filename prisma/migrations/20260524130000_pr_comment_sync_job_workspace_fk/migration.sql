-- Add FK: PrCommentSyncJob.workspaceId → Workspace.id (onDelete: Cascade)
ALTER TABLE "pr_comment_sync_jobs" ADD CONSTRAINT "pr_comment_sync_jobs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
