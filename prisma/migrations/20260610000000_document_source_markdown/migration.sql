-- LUM-408: byte-identical markdown source of the last markdown upload.
-- Additive, nullable: legacy docs stay NULL until their next markdown write.
ALTER TABLE "Document" ADD COLUMN "sourceMarkdown" TEXT;
