-- LUM-1068: the core's deterministic `## Forbidden` rule source keeps the
-- rule set it last parsed from a project's CLAUDE.md / AGENTS.md, so the next
-- parse can record removed rules as POLICY_WEAKENING without the security
-- plugin. Additive: one new table, no existing table or row is touched. The
-- table starts empty; each project's first observation is a baseline that
-- records nothing.

-- CreateTable
CREATE TABLE "forbidden_rule_snapshots" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "previousSourceHash" TEXT,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forbidden_rule_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forbidden_rule_snapshots_projectId_key" ON "forbidden_rule_snapshots"("projectId");

-- AddForeignKey
ALTER TABLE "forbidden_rule_snapshots" ADD CONSTRAINT "forbidden_rule_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

