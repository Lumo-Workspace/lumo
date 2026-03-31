/*
  Warnings:

  - You are about to drop the column `agentChangedFiles` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `agentDurationMs` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `agentSummary` on the `tasks` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "agentChangedFiles",
DROP COLUMN "agentDurationMs",
DROP COLUMN "agentSummary";
