-- LUM-553: per-project cooldown anchor for the autonomous memory topic-fold pass
ALTER TABLE "projects" ADD COLUMN "lastMemoryFoldAttemptAt" TIMESTAMP(3);
