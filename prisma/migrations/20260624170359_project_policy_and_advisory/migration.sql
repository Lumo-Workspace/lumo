ALTER TYPE "BoundaryCrossingCategory" ADD VALUE 'PROJECT_RULE_VIOLATION';
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE 'POLICY_WEAKENING';

ALTER TABLE "boundary_crossings" ADD COLUMN "advisory" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "boundary_crossings" ADD COLUMN "policyRuleRef" TEXT;

CREATE TABLE "project_policies" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "rules" JSONB NOT NULL,
  "compiledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_policies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_policies_projectId_compiledAt_idx" ON "project_policies"("projectId", "compiledAt");
ALTER TABLE "project_policies" ADD CONSTRAINT "project_policies_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
