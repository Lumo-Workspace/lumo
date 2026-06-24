-- LUM-582: claim faithfulness verdict (independent "测" for the claim "估").
-- Additive only — new table, nullable columns, FK with ON DELETE CASCADE,
-- no data-destructive DDL. Production needs `prisma migrate deploy` on the
-- next deploy; the audit batch (scripts/audit-claim-faithfulness.ts) populates
-- it. No backfill is destructive.
CREATE TABLE "claim_faithfulness_verdicts" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "evidence" JSONB,
    "reasoning" TEXT,
    "diffShas" TEXT[],
    "prNumbers" INTEGER[],
    "diffScope" INTEGER NOT NULL DEFAULT 0,
    "prefilterSignal" TEXT,
    "judgeModel" TEXT NOT NULL,
    "judgedClaimAt" TIMESTAMP(3),
    "judgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_faithfulness_verdicts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "claim_faithfulness_verdicts_taskId_key" ON "claim_faithfulness_verdicts"("taskId");

CREATE INDEX "claim_faithfulness_verdicts_verdict_idx" ON "claim_faithfulness_verdicts"("verdict");

ALTER TABLE "claim_faithfulness_verdicts" ADD CONSTRAINT "claim_faithfulness_verdicts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
