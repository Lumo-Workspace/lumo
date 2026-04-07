-- CreateTable
CREATE TABLE "priority_overrides" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "aiSuggested" "TaskPriority" NOT NULL,
    "userChosen" "TaskPriority" NOT NULL,
    "taskTitle" TEXT NOT NULL,
    "taskDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "priority_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "priority_overrides_memberId_projectId_idx" ON "priority_overrides"("memberId", "projectId");

-- AddForeignKey
ALTER TABLE "priority_overrides" ADD CONSTRAINT "priority_overrides_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_overrides" ADD CONSTRAINT "priority_overrides_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
