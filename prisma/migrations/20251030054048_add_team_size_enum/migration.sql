-- CreateEnum
CREATE TYPE "TeamSize" AS ENUM ('ONE', 'TWO_TO_FIVE', 'SIX_TO_TWENTY', 'TWENTY_ONE_TO_FIFTY', 'FIFTY_ONE_TO_TWO_HUNDRED', 'TWO_HUNDRED_PLUS');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "teamSize" "TeamSize";
