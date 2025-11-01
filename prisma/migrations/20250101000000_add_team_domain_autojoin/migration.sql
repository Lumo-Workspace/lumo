/*
  Warnings:

  - Added the required columns `allowAutoJoin` to the `teams` table without a default value. This is not possible if the table is not empty.

*/

-- AlterTable
ALTER TABLE "teams" ADD COLUMN "domain" TEXT;
ALTER TABLE "teams" ADD COLUMN "allowAutoJoin" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "teams_domain_idx" ON "teams"("domain");

