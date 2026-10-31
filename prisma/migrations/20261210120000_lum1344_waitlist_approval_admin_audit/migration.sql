-- LUM-1344: waitlist approval fields + platform admin audit table.
-- Additive only. Existing waitlist_entries rows get PENDING / MARKETING_FORM
-- from the column defaults. Production needs `migrate deploy` on next deploy.

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('PENDING', 'APPROVED');

-- CreateEnum
CREATE TYPE "WaitlistSource" AS ENUM ('MARKETING_FORM', 'ONBOARDING_BLOCKED');

-- AlterTable
ALTER TABLE "waitlist_entries" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "inviteCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastInvitedAt" TIMESTAMP(3),
ADD COLUMN     "source" "WaitlistSource" NOT NULL DEFAULT 'MARKETING_FORM',
ADD COLUMN     "status" "WaitlistStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "platform_admin_audit_events" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_admin_audit_events_createdAt_idx" ON "platform_admin_audit_events"("createdAt");

-- CreateIndex
CREATE INDEX "platform_admin_audit_events_adminUserId_createdAt_idx" ON "platform_admin_audit_events"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "platform_admin_audit_events_targetType_targetId_idx" ON "platform_admin_audit_events"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "waitlist_entries_status_createdAt_idx" ON "waitlist_entries"("status", "createdAt");
