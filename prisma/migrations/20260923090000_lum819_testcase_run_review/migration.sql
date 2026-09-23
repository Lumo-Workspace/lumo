-- LUM-819 (D) test case run 抽查复核
--
-- 纯 additive：一张新表 + 两个索引 + 两个外键。
-- 没有 enum 变更、没有 DROP、没有回填、没有对既有列的修改。
--
-- append-only：同一条 run 可有多条复核（改主意就再 append 一条，读端取最新），
-- 所以 testCaseRunId 上是普通索引而不是 UNIQUE。

CREATE TABLE "test_case_run_reviews" (
  "id"                 TEXT NOT NULL,
  "testCaseRunId"      TEXT NOT NULL,
  "taskId"             TEXT NOT NULL,
  "accepted"           BOOLEAN NOT NULL,
  "note"               TEXT,
  "reviewedByMemberId" TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "test_case_run_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "test_case_run_reviews_testCaseRunId_createdAt_idx"
  ON "test_case_run_reviews"("testCaseRunId", "createdAt");

CREATE INDEX "test_case_run_reviews_taskId_idx"
  ON "test_case_run_reviews"("taskId");

ALTER TABLE "test_case_run_reviews"
  ADD CONSTRAINT "test_case_run_reviews_testCaseRunId_fkey"
  FOREIGN KEY ("testCaseRunId") REFERENCES "test_case_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "test_case_run_reviews"
  ADD CONSTRAINT "test_case_run_reviews_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
