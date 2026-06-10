-- CreateEnum
CREATE TYPE "DependencyKind" AS ENUM ('BLOCKS', 'RELATES');

-- CreateEnum
CREATE TYPE "DependencySource" AS ENUM ('MANUAL', 'DETECTED');

-- CreateEnum
CREATE TYPE "DependencyStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'DISMISSED');

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "blockedTaskId" TEXT NOT NULL,
    "blockingTaskId" TEXT NOT NULL,
    "kind" "DependencyKind" NOT NULL DEFAULT 'BLOCKS',
    "source" "DependencySource" NOT NULL,
    "status" "DependencyStatus" NOT NULL DEFAULT 'SUGGESTED',
    "reason" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_dependencies_workspaceId_status_idx" ON "task_dependencies"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "task_dependencies_blockingTaskId_idx" ON "task_dependencies"("blockingTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_blockedTaskId_blockingTaskId_key" ON "task_dependencies"("blockedTaskId", "blockingTaskId");

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blockedTaskId_fkey" FOREIGN KEY ("blockedTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blockingTaskId_fkey" FOREIGN KEY ("blockingTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
