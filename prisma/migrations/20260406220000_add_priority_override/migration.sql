-- CreateTable
CREATE TABLE "PriorityOverride" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "aiSuggested" "TaskPriority" NOT NULL,
    "userChosen" "TaskPriority" NOT NULL,
    "taskTitle" TEXT NOT NULL,
    "taskDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriorityOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriorityOverride_memberId_projectId_idx" ON "PriorityOverride"("memberId", "projectId");

-- AddForeignKey
ALTER TABLE "PriorityOverride" ADD CONSTRAINT "PriorityOverride_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriorityOverride" ADD CONSTRAINT "PriorityOverride_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
