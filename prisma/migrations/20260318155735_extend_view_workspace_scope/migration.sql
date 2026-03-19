-- AlterTable: add workspaceId as nullable first, memberId as nullable
ALTER TABLE "views" ADD COLUMN "memberId" TEXT,
ADD COLUMN "workspaceId" TEXT,
ALTER COLUMN "projectId" DROP NOT NULL;

-- Backfill workspaceId from the related project
UPDATE "views" v
SET "workspaceId" = p."workspaceId"
FROM "projects" p
WHERE v."projectId" = p."id";

-- Now enforce NOT NULL
ALTER TABLE "views" ALTER COLUMN "workspaceId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "views_workspaceId_idx" ON "views"("workspaceId");

-- CreateIndex
CREATE INDEX "views_memberId_idx" ON "views"("memberId");

-- AddForeignKey
ALTER TABLE "views" ADD CONSTRAINT "views_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "views" ADD CONSTRAINT "views_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
