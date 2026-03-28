-- CreateEnum
CREATE TYPE "AssigneeType" AS ENUM ('human', 'agent');

-- Normalise existing values: null → 'human', anything not 'agent' → 'human'
UPDATE "tasks"
SET "assigneeType" = 'human'
WHERE "assigneeType" IS NULL OR "assigneeType" NOT IN ('agent');

-- AlterTable: convert the string column to the enum type in-place
ALTER TABLE "tasks"
  ALTER COLUMN "assigneeType" DROP DEFAULT,
  ALTER COLUMN "assigneeType" TYPE "AssigneeType" USING "assigneeType"::"AssigneeType",
  ALTER COLUMN "assigneeType" SET NOT NULL,
  ALTER COLUMN "assigneeType" SET DEFAULT 'human'::"AssigneeType";
