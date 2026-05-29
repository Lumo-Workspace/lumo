-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "createdByMemberId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
