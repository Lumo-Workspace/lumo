/*
  Warnings:

  - You are about to drop the column `folderId` on the `documents` table. All the data in the column will be lost.
  - You are about to drop the `folders` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."documents" DROP CONSTRAINT "documents_folderId_fkey";

-- DropForeignKey
ALTER TABLE "public"."folders" DROP CONSTRAINT "folders_parentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."folders" DROP CONSTRAINT "folders_workspaceId_fkey";

-- DropIndex
DROP INDEX "public"."documents_folderId_idx";

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "folderId";

-- DropTable
DROP TABLE "public"."folders";
