-- LUM-1133: per-repository automatic PR review settings. Purely additive: one
-- new table. No row = the defaults (review on, drafts skipped), so no backfill.

-- CreateTable
CREATE TABLE "repository_review_settings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "autoReview" BOOLEAN NOT NULL DEFAULT true,
    "reviewDrafts" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_review_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repository_review_settings_workspaceId_repo_key" ON "repository_review_settings"("workspaceId", "repo");

-- AddForeignKey
ALTER TABLE "repository_review_settings" ADD CONSTRAINT "repository_review_settings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
