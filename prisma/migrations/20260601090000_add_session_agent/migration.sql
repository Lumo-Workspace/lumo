-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "agent" "TaskArtifactAgent" NOT NULL DEFAULT 'CLAUDE_CODE';
