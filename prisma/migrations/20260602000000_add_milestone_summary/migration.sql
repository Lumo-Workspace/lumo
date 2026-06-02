-- CreateTable
CREATE TABLE "milestone_summaries" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "tldr" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "milestone_summaries_milestoneId_key" ON "milestone_summaries"("milestoneId");

-- AddForeignKey
ALTER TABLE "milestone_summaries" ADD CONSTRAINT "milestone_summaries_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
