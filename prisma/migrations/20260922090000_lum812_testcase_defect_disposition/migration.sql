-- LUM-812 test case PROVEN_DEFECT 升为可处置的拦截面
--
-- 纯 additive：两个新枚举类型 + 一张新表 + 一个 TaskActivityType 值。
-- 没有 DROP、没有回填、没有对既有列的修改。
--
-- ⚠ 下面对 "TaskActivityType" 用的是 ALTER TYPE ... ADD VALUE。PostgreSQL 不允许
-- 在同一事务里**使用**刚添加的 enum 值（加是可以的）。本文件只添加、不写入任何
-- 使用该值的行，因此安全；后续迁移若要用它，必须另起一个文件。
-- 同理，KNOWN_DEFECT / NOT_A_DEFECT 建的是**新类型**而不是给既有枚举 ADD VALUE。

ALTER TYPE "TaskActivityType" ADD VALUE 'TEST_CASE_DEFECT_DISPOSITIONED';

CREATE TYPE "TestCaseDefectDisposition" AS ENUM (
  'KNOWN_DEFECT',
  'NOT_A_DEFECT'
);

CREATE TYPE "TestCaseDispositionChannel" AS ENUM (
  'WEB',
  'CLI'
);

-- 处置绑定在被处置的那一条 run 上（runId UNIQUE），不是绑在用例上：
-- 闸门读每条用例最新一条 run 的信号，所以新 defect run 不被旧处置遮蔽。
CREATE TABLE "test_case_run_dispositions" (
  "id"                TEXT NOT NULL,
  "runId"             TEXT NOT NULL,
  "taskId"            TEXT NOT NULL,
  "disposition"       "TestCaseDefectDisposition" NOT NULL,
  "note"              TEXT,
  "dispositionedById" TEXT NOT NULL,
  "dispositionedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "channel"           "TestCaseDispositionChannel" NOT NULL,

  CONSTRAINT "test_case_run_dispositions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "test_case_run_dispositions_runId_key"
  ON "test_case_run_dispositions"("runId");

CREATE INDEX "test_case_run_dispositions_taskId_idx"
  ON "test_case_run_dispositions"("taskId");

ALTER TABLE "test_case_run_dispositions"
  ADD CONSTRAINT "test_case_run_dispositions_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "test_case_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "test_case_run_dispositions"
  ADD CONSTRAINT "test_case_run_dispositions_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
