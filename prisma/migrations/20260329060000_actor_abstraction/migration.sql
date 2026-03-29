-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('HUMAN', 'AGENT');
CREATE TYPE "AgentType" AS ENUM ('CODING', 'REVIEW', 'PLANNER');

-- CreateTable: agent_profiles
CREATE TABLE "agent_profiles" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AgentType" NOT NULL,
    "avatarColor" TEXT NOT NULL DEFAULT '#6366f1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_profiles_workspaceId_type_key" ON "agent_profiles"("workspaceId", "type");
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: actors
CREATE TABLE "actors" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "ActorType" NOT NULL,
    "memberId" TEXT,
    "agentId" TEXT,
    CONSTRAINT "actors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "actors_memberId_key" ON "actors"("memberId");
CREATE UNIQUE INDEX "actors_agentId_key" ON "actors"("agentId");
CREATE INDEX "actors_workspaceId_idx" ON "actors"("workspaceId");
ALTER TABLE "actors" ADD CONSTRAINT "actors_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "actors" ADD CONSTRAINT "actors_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "workspace_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "actors" ADD CONSTRAINT "actors_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: task_activities
CREATE TABLE "task_activities" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_activities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_activities_taskId_idx" ON "task_activities"("taskId");
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: create an Actor for every existing WorkspaceMember
INSERT INTO "actors" ("id", "workspaceId", "type", "memberId")
SELECT gen_random_uuid()::text, wm."workspaceId", 'HUMAN'::"ActorType", wm."id"
FROM "workspace_members" wm;

-- Seed: create a Coding Agent profile + actor for each workspace
INSERT INTO "agent_profiles" ("id", "workspaceId", "name", "type")
SELECT gen_random_uuid()::text, w."id", 'Coding Agent', 'CODING'::"AgentType"
FROM "workspaces" w;

INSERT INTO "actors" ("id", "workspaceId", "type", "agentId")
SELECT gen_random_uuid()::text, ap."workspaceId", 'AGENT'::"ActorType", ap."id"
FROM "agent_profiles" ap;

-- Task: add new columns
ALTER TABLE "tasks" ADD COLUMN "assigneeActorId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "reviewerActorId" TEXT;

-- Migrate task.assigneeId → assigneeActorId
UPDATE "tasks" t
SET "assigneeActorId" = a."id"
FROM "actors" a
WHERE a."memberId" = t."assigneeId" AND t."assigneeId" IS NOT NULL;

-- Migrate agent-assigned tasks (subquery to avoid target table ref in FROM JOIN)
UPDATE "tasks"
SET "assigneeActorId" = sub."actorId"
FROM (
  SELECT t."id" AS task_id, a."id" AS "actorId"
  FROM "tasks" t
  JOIN "projects" p ON t."projectId" = p."id"
  JOIN "actors" a ON a."workspaceId" = p."workspaceId"
  JOIN "agent_profiles" ap ON a."agentId" = ap."id" AND ap."type" = 'CODING'
  WHERE t."assigneeType" = 'agent'
) sub
WHERE "tasks"."id" = sub.task_id;

-- Migrate task.reviewerId → reviewerActorId
UPDATE "tasks" t
SET "reviewerActorId" = a."id"
FROM "actors" a
WHERE a."memberId" = t."reviewerId" AND t."reviewerId" IS NOT NULL;

-- Add FK constraints for new columns
CREATE INDEX "tasks_assigneeActorId_idx" ON "tasks"("assigneeActorId");
CREATE INDEX "tasks_reviewerActorId_idx" ON "tasks"("reviewerActorId");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeActorId_fkey" FOREIGN KEY ("assigneeActorId") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewerActorId_fkey" FOREIGN KEY ("reviewerActorId") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop old columns and constraints
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_assigneeId_fkey";
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_reviewerId_fkey";
DROP INDEX IF EXISTS "tasks_assigneeId_idx";
DROP INDEX IF EXISTS "tasks_reviewerId_idx";
ALTER TABLE "tasks" DROP COLUMN "assigneeId";
ALTER TABLE "tasks" DROP COLUMN "reviewerId";
ALTER TABLE "tasks" DROP COLUMN "assigneeType";

-- Comment: rename authorId → authorActorId, migrate data
ALTER TABLE "comments" ADD COLUMN "authorActorId" TEXT;

UPDATE "comments" c
SET "authorActorId" = a."id"
FROM "actors" a
WHERE a."memberId" = c."authorId" AND c."authorId" IS NOT NULL;

-- Agent comments: map to workspace's agent actor (subquery to avoid target table ref)
UPDATE "comments"
SET "authorActorId" = sub."actorId"
FROM (
  SELECT c."id" AS comment_id, a."id" AS "actorId"
  FROM "comments" c
  JOIN "tasks" t ON c."taskId" = t."id"
  JOIN "projects" p ON t."projectId" = p."id"
  JOIN "actors" a ON a."workspaceId" = p."workspaceId"
  JOIN "agent_profiles" ap ON a."agentId" = ap."id" AND ap."type" = 'CODING'
  WHERE c."type" = 'agent' AND c."authorActorId" IS NULL
) sub
WHERE "comments"."id" = sub.comment_id;

ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_authorId_fkey";
DROP INDEX IF EXISTS "comments_authorId_idx";
ALTER TABLE "comments" DROP COLUMN "authorId";

CREATE INDEX "comments_authorActorId_idx" ON "comments"("authorActorId");
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorActorId_fkey" FOREIGN KEY ("authorActorId") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop AssigneeType enum
DROP TYPE IF EXISTS "AssigneeType";
