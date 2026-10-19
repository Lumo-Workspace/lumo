-- LUM-1240: customer / agent feedback to the Lumo team. Additive only:
-- three new enum types, two new tables, one new counter column.

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('BUG', 'IDEA', 'QUESTION');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'TRIAGED', 'RESOLVED', 'WONTFIX');

-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('CLI', 'WEB', 'API');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "feedbackSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" "FeedbackKind" NOT NULL DEFAULT 'BUG',
    "title" TEXT NOT NULL,
    "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expected" TEXT,
    "actual" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "environment" JSONB,
    "taskRef" TEXT,
    "sessionId" TEXT,
    "submittedByMemberId" TEXT,
    "submittedVia" "FeedbackSource" NOT NULL,
    "secretsRedacted" INTEGER NOT NULL DEFAULT 0,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_replies" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_seq_key" ON "feedback"("seq");

-- CreateIndex
CREATE INDEX "feedback_workspaceId_createdAt_idx" ON "feedback"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_submittedByMemberId_createdAt_idx" ON "feedback"("submittedByMemberId", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_status_createdAt_idx" ON "feedback"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_workspaceId_number_key" ON "feedback"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "feedback_replies_feedbackId_createdAt_idx" ON "feedback_replies"("feedbackId", "createdAt");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_submittedByMemberId_fkey" FOREIGN KEY ("submittedByMemberId") REFERENCES "workspace_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

