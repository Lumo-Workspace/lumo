-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('CAPTURED', 'PLANNED');

-- CreateTable
CREATE TABLE "ideas" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "parentId" TEXT,
    "statement" TEXT NOT NULL,
    "sourceContext" TEXT,
    "status" "IdeaStatus" NOT NULL DEFAULT 'CAPTURED',
    "proposedByMemberId" TEXT NOT NULL,
    "sourceSessionId" TEXT,
    "sourceTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "priorities" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "declaredByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "priorities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ideas_teamId_status_idx" ON "ideas"("teamId", "status");

-- CreateIndex
CREATE INDEX "ideas_workspaceId_idx" ON "ideas"("workspaceId");

-- CreateIndex
CREATE INDEX "ideas_parentId_idx" ON "ideas"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ideas_teamId_number_key" ON "ideas"("teamId", "number");

-- CreateIndex
CREATE INDEX "priorities_teamId_effectiveFrom_idx" ON "priorities"("teamId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priorities" ADD CONSTRAINT "priorities_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priorities" ADD CONSTRAINT "priorities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
