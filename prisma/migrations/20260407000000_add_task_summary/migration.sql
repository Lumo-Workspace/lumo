-- CreateEnum
CREATE TYPE "SummaryFrequency" AS ENUM ('DAILY', 'EVERY_TWO_DAYS', 'WEEKLY');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "summaryEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "summaryFrequency" "SummaryFrequency" NOT NULL DEFAULT 'DAILY',
ADD COLUMN     "summaryLocale" TEXT NOT NULL DEFAULT 'en';

-- CreateTable
CREATE TABLE "ProjectSummary" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "tldr" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSummary" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "tldr" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectSummary_projectId_generatedAt_idx" ON "ProjectSummary"("projectId", "generatedAt" DESC);

-- CreateIndex
CREATE INDEX "WorkspaceSummary_workspaceId_generatedAt_idx" ON "WorkspaceSummary"("workspaceId", "generatedAt" DESC);

-- AddForeignKey
ALTER TABLE "ProjectSummary" ADD CONSTRAINT "ProjectSummary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSummary" ADD CONSTRAINT "WorkspaceSummary_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
