-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "avatarMetadata" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarBlobId" TEXT,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "displayName" TEXT;

-- CreateIndex
CREATE INDEX "users_displayName_idx" ON "users"("displayName");
