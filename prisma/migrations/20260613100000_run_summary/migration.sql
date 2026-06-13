-- LUM-481: add run-summary columns, drop dead progress-comment watermark
ALTER TABLE "sessions" ADD COLUMN "runSummary" TEXT;
ALTER TABLE "sessions" ADD COLUMN "runSummaryGeneratedAt" TIMESTAMP(3);
ALTER TABLE "sessions" DROP COLUMN "lastProgressCommentAt";
