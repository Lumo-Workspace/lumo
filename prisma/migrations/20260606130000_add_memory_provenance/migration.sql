-- CreateTable
CREATE TABLE "memory_provenance" (
    "id" TEXT NOT NULL,
    "childMemoryId" TEXT NOT NULL,
    "parentMemoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "memory_provenance_childMemoryId_parentMemoryId_key" ON "memory_provenance"("childMemoryId", "parentMemoryId");

-- CreateIndex
CREATE INDEX "memory_provenance_parentMemoryId_idx" ON "memory_provenance"("parentMemoryId");
