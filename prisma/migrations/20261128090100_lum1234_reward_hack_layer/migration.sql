-- LUM-1234: reward-hack layer. Additive only: two nullable/defaulted columns and one new table.
ALTER TABLE "workspaces" ADD COLUMN "securityRewardHackEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "pr_security_scans" ADD COLUMN "rewardHackState" JSONB;

-- CreateTable
CREATE TABLE "workspace_llm_spend" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "usdMicros" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_llm_spend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_llm_spend_workspaceId_feature_month_key" ON "workspace_llm_spend"("workspaceId", "feature", "month");

-- AddForeignKey
ALTER TABLE "workspace_llm_spend" ADD CONSTRAINT "workspace_llm_spend_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
