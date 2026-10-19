-- LUM-1157: a PR-review learning on a repository linked to no Lumo project is
-- stored scoped to the workspace + repository (its pr_review_learnings row);
-- its memory has no project. Additive: relaxes NOT NULL only, no data change.
-- Every existing row keeps its projectId; project readers filter by
-- projectId and so never see a project-less row.
ALTER TABLE "memories" ALTER COLUMN "projectId" DROP NOT NULL;
