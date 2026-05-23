CREATE TYPE "DocMentionSource" AS ENUM ('CONTENT', 'EXPLICIT');

ALTER TABLE "DocumentMention"
ADD COLUMN "source" "DocMentionSource" NOT NULL DEFAULT 'CONTENT';
