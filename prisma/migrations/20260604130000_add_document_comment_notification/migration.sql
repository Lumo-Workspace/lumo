-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DOCUMENT_COMMENT_MENTIONED';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "documentId" TEXT;
ALTER TABLE "notifications" ADD COLUMN "documentCommentId" TEXT;
