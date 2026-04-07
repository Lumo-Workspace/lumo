-- Add tags array to Document
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Create DocumentEditor table
CREATE TABLE IF NOT EXISTS "DocumentEditor" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "lastEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentEditor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentEditor_documentId_memberId_key" ON "DocumentEditor"("documentId", "memberId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentEditor_documentId_fkey'
  ) THEN
    ALTER TABLE "DocumentEditor" ADD CONSTRAINT "DocumentEditor_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DocumentEditor_memberId_fkey'
  ) THEN
    ALTER TABLE "DocumentEditor" ADD CONSTRAINT "DocumentEditor_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
