ALTER TABLE "agent_runs"
  ADD COLUMN "inputTokens" INTEGER,
  ADD COLUMN "outputTokens" INTEGER,
  ADD COLUMN "cacheReadTokens" INTEGER,
  ADD COLUMN "cacheCreationTokens" INTEGER,
  ADD COLUMN "loopCount" INTEGER;

ALTER TABLE "sessions"
  ADD COLUMN "inputTokens" INTEGER,
  ADD COLUMN "outputTokens" INTEGER,
  ADD COLUMN "cacheReadTokens" INTEGER,
  ADD COLUMN "cacheCreationTokens" INTEGER,
  ADD COLUMN "loopCount" INTEGER;
