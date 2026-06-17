-- LUM-542: append-only agent self-explanation ("申辩") layer on boundary crossings.
-- Purely additive — one nullable column on boundary_crossings plus a new
-- insert-only table. No data is modified or dropped.

-- AlterTable
ALTER TABLE "boundary_crossings" ADD COLUMN "agentNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "boundary_crossing_explanations" (
    "id" TEXT NOT NULL,
    "crossingId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "authorSessionId" TEXT,
    "authorAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boundary_crossing_explanations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "boundary_crossing_explanations_crossingId_createdAt_idx" ON "boundary_crossing_explanations"("crossingId", "createdAt");

-- AddForeignKey
ALTER TABLE "boundary_crossing_explanations" ADD CONSTRAINT "boundary_crossing_explanations_crossingId_fkey" FOREIGN KEY ("crossingId") REFERENCES "boundary_crossings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
