-- Drop the old foreign key constraint
ALTER TABLE "projects" DROP CONSTRAINT "projects_defaultReviewerId_fkey";

-- Rename the column
ALTER TABLE "projects" RENAME COLUMN "defaultReviewerId" TO "ownerId";

-- Recreate the foreign key constraint with the new name
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
