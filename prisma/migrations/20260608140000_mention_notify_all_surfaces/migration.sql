-- Add new mention notification types
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_MENTIONED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MILESTONE_MENTIONED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DOCUMENT_MENTIONED';

-- Add entity reference columns for non-task mention notifications
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "milestoneId" TEXT;
