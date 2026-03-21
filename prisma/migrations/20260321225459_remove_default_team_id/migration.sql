/*
  Warnings:

  - You are about to drop the column `defaultTeamId` on the `workspace_members` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_defaultTeamId_fkey";

-- DropIndex
DROP INDEX "workspace_members_defaultTeamId_idx";

-- AlterTable
ALTER TABLE "workspace_members" DROP COLUMN "defaultTeamId";
