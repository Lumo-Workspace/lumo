/*
  Warnings:

  - You are about to drop the column `clarifyContext` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `clarifyQuestion` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `clarifyReply` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `githubPrNumber` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `githubPrStatus` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `githubPrUrl` on the `tasks` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "pull_requests" DROP CONSTRAINT "pull_requests_integrationId_fkey";

-- DropForeignKey
ALTER TABLE "slack_channels" DROP CONSTRAINT "slack_channels_projectId_fkey";

-- AlterTable
ALTER TABLE "pull_requests" ALTER COLUMN "integrationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "clarifyContext",
DROP COLUMN "clarifyQuestion",
DROP COLUMN "clarifyReply",
DROP COLUMN "githubPrNumber",
DROP COLUMN "githubPrStatus",
DROP COLUMN "githubPrUrl";

-- CreateTable
CREATE TABLE "agent_clarifies" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "context" TEXT,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_clarifies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_clarifies_taskId_idx" ON "agent_clarifies"("taskId");

-- AddForeignKey
ALTER TABLE "slack_channels" ADD CONSTRAINT "slack_channels_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "github_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_clarifies" ADD CONSTRAINT "agent_clarifies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
