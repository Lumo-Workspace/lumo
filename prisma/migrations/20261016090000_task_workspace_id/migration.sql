-- LUM-992: denormalize Task.workspaceId (from projects.workspaceId) so the
-- data-layer tenant check (lib/db/workspace-scope.ts) and a future RLS policy
-- cover "tasks" directly.
--
-- Additive: no row is deleted, no existing column changes. Steps:
--   1. add the column nullable (catalog-only change, no table rewrite)
--   2. backfill every row from its project (one UPDATE; "projectId" is NOT
--      NULL with an FK to "projects", so every row gets a value)
--   3. guard trigger, so a task can never disagree with its project:
--      - INSERT without workspaceId -> filled from the project. This keeps the
--        previous deployment's code (which doesn't send the column) working
--        between this migration and the new deployment going live.
--      - INSERT/UPDATE with a workspaceId other than the project's -> rejected
--        (check_violation), so a cross-workspace project move fails at the DB.
--      - a project's own workspaceId changing -> its tasks follow.
--   4. SET NOT NULL, FK to "workspaces" (ON DELETE CASCADE, same as the
--      existing tasks -> projects -> workspaces cascade), index.
--
-- Locking: ADD COLUMN takes ACCESS EXCLUSIVE on "tasks" and the file runs as
-- one script, so reads and writes on "tasks" wait until it commits. Every
-- step is one pass over "tasks" (UPDATE, NOT NULL scan, FK validation, index
-- build); at the current table size (low thousands of rows) that is well under
-- a second. See the LUM-992 PR description for production notes.

-- 1. AlterTable
ALTER TABLE "tasks" ADD COLUMN "workspaceId" TEXT;

-- 2. Backfill
UPDATE "tasks" t
SET "workspaceId" = p."workspaceId"
FROM "projects" p
WHERE t."projectId" = p."id"
  AND t."workspaceId" IS NULL;

-- 3. Guard: tasks.workspaceId always equals its project's workspaceId.
CREATE FUNCTION "tasks_workspace_id_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  project_workspace TEXT;
BEGIN
  SELECT p."workspaceId" INTO project_workspace
  FROM "projects" p
  WHERE p."id" = NEW."projectId";
  -- Unknown project: leave it to the projectId foreign key to reject.
  IF project_workspace IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."workspaceId" IS NULL THEN
    NEW."workspaceId" := project_workspace;
  ELSIF NEW."workspaceId" <> project_workspace THEN
    RAISE EXCEPTION 'task workspaceId does not match its project''s workspace'
      USING ERRCODE = 'check_violation',
            DETAIL = 'tasks.workspaceId must equal projects.workspaceId (LUM-992)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tasks_workspace_id_guard"
BEFORE INSERT OR UPDATE OF "projectId", "workspaceId" ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "tasks_workspace_id_guard"();

CREATE FUNCTION "projects_workspace_id_propagate"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "tasks" SET "workspaceId" = NEW."workspaceId"
  WHERE "projectId" = NEW."id";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "projects_workspace_id_propagate"
AFTER UPDATE OF "workspaceId" ON "projects"
FOR EACH ROW
WHEN (OLD."workspaceId" IS DISTINCT FROM NEW."workspaceId")
EXECUTE FUNCTION "projects_workspace_id_propagate"();

-- 4. Constraints + index
ALTER TABLE "tasks" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Leading column serves the by-workspace task reads (scoped by-id lookups go
-- through the primary key); status is the most common extra filter.
CREATE INDEX "tasks_workspaceId_status_idx" ON "tasks"("workspaceId", "status");
