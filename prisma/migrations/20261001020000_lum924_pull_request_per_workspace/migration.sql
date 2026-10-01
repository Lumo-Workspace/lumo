-- LUM-924: a pull request row is unique per workspace, not globally, so
-- several workspaces sharing one GitHub App installation can each track the
-- same repository's PRs. Index swap only; no rows are touched. Existing rows
-- are unique on (repo, number), so they satisfy the wider key as-is.

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_workspaceId_repo_number_key" ON "pull_requests"("workspaceId", "repo", "number");

-- DropIndex
DROP INDEX "pull_requests_repo_number_key";
