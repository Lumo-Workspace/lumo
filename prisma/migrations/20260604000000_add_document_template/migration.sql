-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "emoji" TEXT,
    "content" TEXT NOT NULL,
    "sortOrder" DOUBLE PRECISION NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_key_key" ON "DocumentTemplate"("key");

-- CreateIndex
CREATE INDEX "DocumentTemplate_workspaceId_idx" ON "DocumentTemplate"("workspaceId");

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
