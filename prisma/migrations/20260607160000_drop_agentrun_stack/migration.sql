-- LUM-292: delete the dormant AgentRun / cloud-sandbox (E2B) execution stack.
-- DATA-DESTRUCTIVE: drops agent_runs + agent_clarifies and the lineage_edges.runId
-- column. Production needs `prisma migrate deploy` on next deploy; existing rows in
-- these two tables (and any non-null lineage_edges.runId) are permanently removed.

-- DropForeignKey
ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_taskId_fkey";

-- DropForeignKey
ALTER TABLE "agent_clarifies" DROP CONSTRAINT "agent_clarifies_taskId_fkey";

-- DropForeignKey
ALTER TABLE "agent_clarifies" DROP CONSTRAINT "agent_clarifies_agentRunId_fkey";

-- DropForeignKey
ALTER TABLE "lineage_edges" DROP CONSTRAINT "lineage_edges_runId_fkey";

-- AlterTable
ALTER TABLE "lineage_edges" DROP COLUMN "runId";

-- DropTable
DROP TABLE "agent_runs";

-- DropTable
DROP TABLE "agent_clarifies";
