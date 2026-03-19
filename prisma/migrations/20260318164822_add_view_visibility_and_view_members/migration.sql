-- CreateEnum
CREATE TYPE "ViewVisibility" AS ENUM ('PRIVATE', 'WORKSPACE', 'SHARED');

-- CreateEnum
CREATE TYPE "ViewMemberRole" AS ENUM ('VIEWER', 'EDITOR');

-- AlterTable
ALTER TABLE "views" ADD COLUMN     "createdByMemberId" TEXT,
ADD COLUMN     "visibility" "ViewVisibility" NOT NULL DEFAULT 'WORKSPACE';

-- CreateTable
CREATE TABLE "view_members" (
    "id" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "role" "ViewMemberRole" NOT NULL DEFAULT 'VIEWER',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "view_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "view_members_viewId_memberId_key" ON "view_members"("viewId", "memberId");

-- AddForeignKey
ALTER TABLE "views" ADD CONSTRAINT "views_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "view_members" ADD CONSTRAINT "view_members_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "views"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "view_members" ADD CONSTRAINT "view_members_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
