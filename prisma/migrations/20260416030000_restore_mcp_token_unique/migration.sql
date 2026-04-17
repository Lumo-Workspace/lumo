-- Restore unique index that was manually dropped from dev DB outside migration history.
-- The original index was created by migration 20260401200000_add_mcp_token_unique
-- but was subsequently removed without a corresponding migration, causing drift
-- between migration history and actual DB schema.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_runs_mcpToken_key" ON "agent_runs"("mcpToken");
