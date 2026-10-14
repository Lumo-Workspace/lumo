-- LUM-1135: milestone-level test cases. Additive only — no data is touched.
ALTER TABLE "test_cases" ALTER COLUMN "taskId" DROP NOT NULL;
ALTER TABLE "test_cases" ADD COLUMN "milestoneId" TEXT;
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_milestoneId_fkey"
  FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_owner_check"
  CHECK (num_nonnulls("taskId", "milestoneId") = 1);
CREATE UNIQUE INDEX "test_cases_milestoneId_number_key" ON "test_cases"("milestoneId", "number");
CREATE INDEX "test_cases_milestoneId_deletedAt_idx" ON "test_cases"("milestoneId", "deletedAt");

ALTER TABLE "test_case_runs" ALTER COLUMN "taskId" DROP NOT NULL;
ALTER TABLE "test_case_runs" ADD COLUMN "milestoneId" TEXT;
ALTER TABLE "test_case_runs" ADD CONSTRAINT "test_case_runs_milestoneId_fkey"
  FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_case_runs" ADD CONSTRAINT "test_case_runs_owner_check"
  CHECK (num_nonnulls("taskId", "milestoneId") = 1);
CREATE INDEX "test_case_runs_milestoneId_createdAt_idx" ON "test_case_runs"("milestoneId", "createdAt");

ALTER TABLE "test_case_run_dispositions" ALTER COLUMN "taskId" DROP NOT NULL;
ALTER TABLE "test_case_run_dispositions" ADD COLUMN "milestoneId" TEXT;
ALTER TABLE "test_case_run_dispositions" ADD CONSTRAINT "test_case_run_dispositions_milestoneId_fkey"
  FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_case_run_dispositions" ADD CONSTRAINT "test_case_run_dispositions_owner_check"
  CHECK (num_nonnulls("taskId", "milestoneId") = 1);
CREATE INDEX "test_case_run_dispositions_milestoneId_idx" ON "test_case_run_dispositions"("milestoneId");
