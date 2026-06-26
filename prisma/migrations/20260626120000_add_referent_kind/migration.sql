-- CreateEnum
CREATE TYPE "ReferentKind" AS ENUM ('EXTERNAL_FACT', 'AGENT_CONSTRUCTED_STATE', 'PENDING_OUTCOME');

-- AlterTable
ALTER TABLE "acceptance_criteria" ADD COLUMN "referentKind" "ReferentKind";
