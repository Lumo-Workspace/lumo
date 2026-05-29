-- CreateEnum
CREATE TYPE "TaskArtifactAgent" AS ENUM ('CLAUDE_CODE', 'CODEX', 'CURSOR', 'GEMINI_CLI', 'GITHUB_COPILOT', 'WINDSURF');

-- AlterTable
ALTER TABLE "task_artifacts" ADD COLUMN "agent" "TaskArtifactAgent" NOT NULL DEFAULT 'CLAUDE_CODE';
