/*
  Warnings:

  - Added the required column `createdByMemberId` to the `projects` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "createdByMemberId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "projects_createdByMemberId_idx" ON "projects"("createdByMemberId");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "workspace_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
