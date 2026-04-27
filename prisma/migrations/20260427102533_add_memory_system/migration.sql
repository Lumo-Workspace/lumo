-- CreateEnum
CREATE TYPE "MemoryCategory" AS ENUM ('TRAP', 'DECISION', 'CONVENTION', 'PROCEDURAL');

-- CreateEnum
CREATE TYPE "MemoryScope" AS ENUM ('TASK', 'PROJECT');

-- AlterEnum
ALTER TYPE "HookEventType" ADD VALUE 'POST_TOOL_USE_FAILURE';

-- CreateTable
CREATE TABLE "memories" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "scope" "MemoryScope" NOT NULL,
    "category" "MemoryCategory" NOT NULL,
    "content" JSONB NOT NULL,
    "sourceSessionId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memories_projectId_scope_idx" ON "memories"("projectId", "scope");

-- CreateIndex
CREATE INDEX "memories_taskId_idx" ON "memories"("taskId");

-- CreateIndex
CREATE INDEX "memories_projectId_archivedAt_idx" ON "memories"("projectId", "archivedAt");

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
