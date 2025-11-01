-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TeamRole" AS ENUM ('owner', 'admin', 'member', 'guest');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "team_members" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "team_members" ALTER COLUMN "role" TYPE "TeamRole" USING ("role"::text::"TeamRole");
ALTER TABLE "team_members" ALTER COLUMN "role" SET DEFAULT 'member';

