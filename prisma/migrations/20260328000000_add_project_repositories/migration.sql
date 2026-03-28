-- Add TASK_SPEC_READY to NotificationType enum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_SPEC_READY';

-- Create project_repositories table
CREATE TABLE IF NOT EXISTS "project_repositories" (
    "id"        TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fullName"  TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_repositories_pkey" PRIMARY KEY ("id")
);

-- Add indexes and foreign key for project_repositories
CREATE UNIQUE INDEX IF NOT EXISTS "project_repositories_projectId_fullName_key"
    ON "project_repositories"("projectId", "fullName");

CREATE INDEX IF NOT EXISTS "project_repositories_projectId_idx"
    ON "project_repositories"("projectId");

ALTER TABLE "project_repositories"
    ADD CONSTRAINT "project_repositories_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Add repositoryId column to tasks
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "repositoryId" TEXT;

-- Add index on tasks.repositoryId
CREATE INDEX IF NOT EXISTS "tasks_repositoryId_idx" ON "tasks"("repositoryId");

-- Add foreign key on tasks.repositoryId
ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_repositoryId_fkey"
    FOREIGN KEY ("repositoryId") REFERENCES "project_repositories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
