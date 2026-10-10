ALTER TABLE "pull_requests"
  ADD COLUMN "reviewPaused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewRoundLimit" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "reviewHeads" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_reviewRoundLimit_check"
  CHECK ("reviewRoundLimit" BETWEEN 1 AND 100);
