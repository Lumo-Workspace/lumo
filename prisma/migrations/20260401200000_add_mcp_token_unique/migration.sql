-- AlterTable: add unique constraint to AgentRun.mcpToken
CREATE UNIQUE INDEX "agent_runs_mcpToken_key" ON "agent_runs"("mcpToken");
