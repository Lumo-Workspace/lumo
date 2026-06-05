-- CreateEnum
CREATE TYPE "DocumentCommentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "DocumentComment" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "authorActorId" TEXT,
    "body" TEXT NOT NULL,
    "parentId" TEXT,
    "quotedText" TEXT,
    "anchorStart" INTEGER,
    "anchorEnd" INTEGER,
    "status" "DocumentCommentStatus" NOT NULL DEFAULT 'OPEN',
    "isOrphaned" BOOLEAN NOT NULL DEFAULT false,
    "resolvedByActorId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "type" "CommentType" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentComment_documentId_deletedAt_idx" ON "DocumentComment"("documentId", "deletedAt");

-- CreateIndex
CREATE INDEX "DocumentComment_parentId_idx" ON "DocumentComment"("parentId");

-- AddForeignKey
ALTER TABLE "DocumentComment" ADD CONSTRAINT "DocumentComment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentComment" ADD CONSTRAINT "DocumentComment_authorActorId_fkey" FOREIGN KEY ("authorActorId") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentComment" ADD CONSTRAINT "DocumentComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DocumentComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentComment" ADD CONSTRAINT "DocumentComment_resolvedByActorId_fkey" FOREIGN KEY ("resolvedByActorId") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
