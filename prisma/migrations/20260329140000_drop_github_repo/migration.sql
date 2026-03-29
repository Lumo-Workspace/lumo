-- Migrate legacy project.githubRepo values into project_repositories table
-- Only insert if no repository already exists for that project
INSERT INTO "project_repositories" ("id", "projectId", "fullName", "name", "isDefault", "createdAt")
SELECT
  gen_random_uuid()::text,
  p."id",
  p."githubRepo",
  split_part(p."githubRepo", '/', 2),
  true,
  NOW()
FROM "projects" p
WHERE p."githubRepo" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "project_repositories" pr WHERE pr."projectId" = p."id"
  );

-- Drop the legacy column
ALTER TABLE "projects" DROP COLUMN "githubRepo";
