-- LUM-680 (Spec2-18): Idea comments + activity timeline.
-- Purely ADDITIVE — no column/table is dropped or retyped. Existing task
-- comments are untouched: `comments.taskId` only loses its NOT NULL so the same
-- table can also hold idea comments (polymorphic owner, one of taskId/ideaId).

-- 1. Comment becomes polymorphic: taskId is now optional, ideaId is added.
ALTER TABLE "comments" ALTER COLUMN "taskId" DROP NOT NULL;
ALTER TABLE "comments" ADD COLUMN "ideaId" TEXT;

-- Exactly one owner: every comment references a task XOR an idea. Enforced in
-- the app layer (assertSingleCommentOwner) and here as a defence-in-depth CHECK.
ALTER TABLE "comments"
  ADD CONSTRAINT "comments_single_owner_chk"
  CHECK (("taskId" IS NOT NULL) <> ("ideaId" IS NOT NULL));

CREATE INDEX "comments_ideaId_idx" ON "comments"("ideaId");

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_ideaId_fkey"
  FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Idea activity timeline.
CREATE TYPE "IdeaActivityType" AS ENUM ('IDEA_CAPTURED', 'STATEMENT_CHANGED', 'STATUS_CHANGED', 'COMMENT_ADDED');

CREATE TABLE "idea_activities" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "IdeaActivityType" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idea_activities_ideaId_createdAt_idx" ON "idea_activities"("ideaId", "createdAt");

ALTER TABLE "idea_activities"
  ADD CONSTRAINT "idea_activities_ideaId_fkey"
  FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "idea_activities"
  ADD CONSTRAINT "idea_activities_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
