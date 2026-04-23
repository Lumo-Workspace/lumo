-- CreateEnum
CREATE TYPE "HookEventType" AS ENUM ('PRE_TOOL_USE', 'POST_TOOL_USE', 'STOP');

-- CreateTable
CREATE TABLE "hook_events" (
    "id"                TEXT            NOT NULL,
    "workspaceId"       TEXT            NOT NULL,
    "workspaceMemberId" TEXT            NOT NULL,
    "sessionId"         TEXT,
    "taskId"            TEXT,
    "type"              "HookEventType" NOT NULL,
    "toolName"          TEXT,
    "payload"           JSONB           NOT NULL,
    "createdAt"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hook_events_workspaceId_createdAt_idx"       ON "hook_events" ("workspaceId", "createdAt");
CREATE INDEX "hook_events_workspaceMemberId_createdAt_idx" ON "hook_events" ("workspaceMemberId", "createdAt");

-- AddForeignKey
ALTER TABLE "hook_events"
  ADD CONSTRAINT "hook_events_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hook_events"
  ADD CONSTRAINT "hook_events_workspaceMemberId_fkey"
  FOREIGN KEY ("workspaceMemberId") REFERENCES "workspace_members"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
