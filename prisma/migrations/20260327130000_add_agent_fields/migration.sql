-- Add coding agent fields to tasks table
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "spec"             TEXT,
  ADD COLUMN IF NOT EXISTS "agentStatus"      TEXT,
  ADD COLUMN IF NOT EXISTS "sandboxId"        TEXT,
  ADD COLUMN IF NOT EXISTS "clarifyQuestion"  TEXT,
  ADD COLUMN IF NOT EXISTS "clarifyContext"   TEXT,
  ADD COLUMN IF NOT EXISTS "clarifyReply"     TEXT,
  ADD COLUMN IF NOT EXISTS "githubPrUrl"      TEXT,
  ADD COLUMN IF NOT EXISTS "githubPrNumber"   INTEGER,
  ADD COLUMN IF NOT EXISTS "githubPrStatus"   TEXT;
