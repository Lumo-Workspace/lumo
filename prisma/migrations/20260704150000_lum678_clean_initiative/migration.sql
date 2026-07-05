-- LUM-678 clean-up (follow-up): make the Initiative model genuinely clean now
-- that data loss is acceptable (no real users yet).
--   1. Drop the redundant `goalStatement` column — `name` is the single source
--      of truth for the initiative's goal text.
--   2. Reduce InitiativeStatus to the clean 5-state Linear enum, dropping the
--      interim legacy values DONE/DROPPED. Existing rows are preserved by mapping
--      DONE→COMPLETED and DROPPED→CANCELLED.
-- This is intentionally DESTRUCTIVE DDL (DROP COLUMN + enum type-swap).

-- DropColumn
ALTER TABLE "initiatives" DROP COLUMN "goalStatement";

-- AlterEnum: reduce to the 5 Linear states, remapping the two legacy values.
CREATE TYPE "InitiativeStatus_new" AS ENUM ('PROPOSED', 'PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');
ALTER TABLE "initiatives" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "initiatives" ALTER COLUMN "status" TYPE "InitiativeStatus_new"
  USING (
    CASE "status"::text
      WHEN 'DONE' THEN 'COMPLETED'
      WHEN 'DROPPED' THEN 'CANCELLED'
      ELSE "status"::text
    END::"InitiativeStatus_new"
  );
ALTER TYPE "InitiativeStatus" RENAME TO "InitiativeStatus_old";
ALTER TYPE "InitiativeStatus_new" RENAME TO "InitiativeStatus";
DROP TYPE "InitiativeStatus_old";
ALTER TABLE "initiatives" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
