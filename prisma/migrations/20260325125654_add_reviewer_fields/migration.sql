-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "defaultReviewerId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "reviewerId" TEXT;

-- CreateIndex
CREATE INDEX "tasks_reviewerId_idx" ON "tasks"("reviewerId");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_defaultReviewerId_fkey" FOREIGN KEY ("defaultReviewerId") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
