-- LUM-409: optimistic-concurrency counter for the document body.
-- Additive, non-destructive: existing rows start at revision 0.
ALTER TABLE "Document" ADD COLUMN "contentRevision" INTEGER NOT NULL DEFAULT 0;
