-- 1. Add AgentStatus enum and migrate Task.agentStatus from String to enum
CREATE TYPE "AgentStatus" AS ENUM ('RUNNING', 'PAUSED', 'DONE', 'FAILED', 'CANCELLED', 'SPEC_REVIEW');

ALTER TABLE "tasks" ADD COLUMN "agentStatusEnum" "AgentStatus";
UPDATE "tasks" SET "agentStatusEnum" = CASE
  WHEN "agentStatus" = 'running'     THEN 'RUNNING'::"AgentStatus"
  WHEN "agentStatus" = 'paused'      THEN 'PAUSED'::"AgentStatus"
  WHEN "agentStatus" = 'done'        THEN 'DONE'::"AgentStatus"
  WHEN "agentStatus" = 'failed'      THEN 'FAILED'::"AgentStatus"
  WHEN "agentStatus" = 'cancelled'   THEN 'CANCELLED'::"AgentStatus"
  WHEN "agentStatus" = 'spec_review' THEN 'SPEC_REVIEW'::"AgentStatus"
  ELSE NULL
END WHERE "agentStatus" IS NOT NULL;
ALTER TABLE "tasks" DROP COLUMN "agentStatus";
ALTER TABLE "tasks" RENAME COLUMN "agentStatusEnum" TO "agentStatus";

-- 2. Rename CommentType enum values: user → USER, agent → AGENT
ALTER TYPE "CommentType" RENAME VALUE 'user' TO 'USER';
ALTER TYPE "CommentType" RENAME VALUE 'agent' TO 'AGENT';

-- 3. Add new NotificationType values
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'AGENT_CLARIFY';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'AGENT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'AGENT_DONE';

-- 4. AgentProfile: add memberId column, drop old unique, create new unique
ALTER TABLE "agent_profiles" ADD COLUMN "memberId" TEXT;
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_profiles" DROP CONSTRAINT IF EXISTS "agent_profiles_workspaceId_type_key";
CREATE UNIQUE INDEX "agent_profiles_workspaceId_type_memberId_key"
  ON "agent_profiles"("workspaceId", "type", "memberId");

-- 5. Notification: add new Actor-based columns
ALTER TABLE "notifications" ADD COLUMN "recipientActorId" TEXT;
ALTER TABLE "notifications" ADD COLUMN "triggerActorId" TEXT;
ALTER TABLE "notifications" ADD COLUMN "clarifyId" TEXT;

-- Migrate recipientId (Clerk userId) → recipientActorId (Actor.id)
UPDATE "notifications" n
SET "recipientActorId" = a."id"
FROM "workspace_members" wm
JOIN "actors" a ON a."memberId" = wm."id"
WHERE wm."clerkId" = n."recipientId" AND wm."workspaceId" = n."workspaceId";

-- Migrate actorId (Clerk userId) → triggerActorId (Actor.id)
UPDATE "notifications" n
SET "triggerActorId" = a."id"
FROM "workspace_members" wm
JOIN "actors" a ON a."memberId" = wm."id"
WHERE wm."clerkId" = n."actorId" AND wm."workspaceId" = n."workspaceId"
  AND n."actorId" IS NOT NULL;

-- Delete orphan notifications that couldn't be migrated (no matching actor)
DELETE FROM "notifications" WHERE "recipientActorId" IS NULL;

-- Make recipientActorId required now that data is migrated
ALTER TABLE "notifications" ALTER COLUMN "recipientActorId" SET NOT NULL;

-- Add FK constraints
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientActorId_fkey"
  FOREIGN KEY ("recipientActorId") REFERENCES "actors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_triggerActorId_fkey"
  FOREIGN KEY ("triggerActorId") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop old columns and index
DROP INDEX IF EXISTS "notifications_recipientId_read_idx";
ALTER TABLE "notifications" DROP COLUMN "recipientId";
ALTER TABLE "notifications" DROP COLUMN "actorId";

-- New index
CREATE INDEX "notifications_recipientActorId_read_idx" ON "notifications"("recipientActorId", "read");
