-- CreateEnum
CREATE TYPE "PrCommentSource" AS ENUM ('ISSUE', 'REVIEW', 'REVIEW_LINE');

-- CreateEnum
CREATE TYPE "DiffSide" AS ENUM ('LEFT', 'RIGHT');

-- CreateEnum
CREATE TYPE "OutboundActorKind" AS ENUM ('USER_OAUTH', 'BOT_APP');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'DEAD_LETTER');

-- AlterEnum
ALTER TYPE "ActorType" ADD VALUE 'GITHUB_USER';

-- AlterTable
ALTER TABLE "actors" ADD COLUMN     "externalAvatarUrl" TEXT,
ADD COLUMN     "externalIdentity" TEXT;

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "pr_comment_mirrors" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "externalSource" "PrCommentSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalNodeId" TEXT,
    "externalUrl" TEXT NOT NULL,
    "externalUpdatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "filePath" TEXT,
    "lineStart" INTEGER,
    "lineEnd" INTEGER,
    "diffSide" "DiffSide",
    "inReplyToExternalId" TEXT,
    "outboundActor" "OutboundActorKind" NOT NULL,
    "outboundActorUserId" TEXT,
    "bodyHash" TEXT,

    CONSTRAINT "pr_comment_mirrors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pr_comment_sync_jobs" (
    "id" TEXT NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "payload" JSONB NOT NULL,
    "commentId" TEXT,
    "externalId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pr_comment_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pr_comment_mirrors_commentId_key" ON "pr_comment_mirrors"("commentId");

-- CreateIndex
CREATE INDEX "pr_comment_mirrors_pullRequestId_idx" ON "pr_comment_mirrors"("pullRequestId");

-- CreateIndex
CREATE INDEX "pr_comment_mirrors_pullRequestId_bodyHash_lastSyncedAt_idx" ON "pr_comment_mirrors"("pullRequestId", "bodyHash", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pr_comment_mirrors_externalSource_externalId_key" ON "pr_comment_mirrors"("externalSource", "externalId");

-- CreateIndex
CREATE INDEX "pr_comment_sync_jobs_status_scheduledFor_idx" ON "pr_comment_sync_jobs"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "pr_comment_sync_jobs_workspaceId_idx" ON "pr_comment_sync_jobs"("workspaceId");

-- CreateIndex
CREATE INDEX "pr_comment_sync_jobs_commentId_idx" ON "pr_comment_sync_jobs"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "actors_workspaceId_externalIdentity_key" ON "actors"("workspaceId", "externalIdentity");

-- AddForeignKey
ALTER TABLE "pr_comment_mirrors" ADD CONSTRAINT "pr_comment_mirrors_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pr_comment_mirrors" ADD CONSTRAINT "pr_comment_mirrors_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pr_comment_sync_jobs" ADD CONSTRAINT "pr_comment_sync_jobs_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
