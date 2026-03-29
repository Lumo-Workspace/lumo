-- CreateEnum
CREATE TYPE "CommentType" AS ENUM ('user', 'agent');

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "type" "CommentType" NOT NULL DEFAULT 'user';
