-- CreateEnum
CREATE TYPE "LumoProposalStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "lumo_proposals" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" "LumoProposalStatus" NOT NULL DEFAULT 'PENDING',
    "operations" JSONB NOT NULL,
    "lumoMdSnapshot" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "lumo_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lumo_proposals_projectId_idx" ON "lumo_proposals"("projectId");

-- CreateIndex
CREATE INDEX "lumo_proposals_taskId_idx" ON "lumo_proposals"("taskId");

-- AddForeignKey
ALTER TABLE "lumo_proposals" ADD CONSTRAINT "lumo_proposals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lumo_proposals" ADD CONSTRAINT "lumo_proposals_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
