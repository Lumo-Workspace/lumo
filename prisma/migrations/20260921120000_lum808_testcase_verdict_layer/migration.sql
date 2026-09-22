-- LUM-808 test case 判决层：FAIL 归因 + 可证明性上限
--
-- 纯 additive：新枚举类型 + 三个可空/带默认的列。没有 DROP、没有回填。
-- TestCaseRun 是 append-only 事件日志，历史行的 failureAttribution 只能是
-- NULL（读作「记录于归因机制之前」），这是设计，不是待补的数据缺口。
--
-- 注意这里建的是**新枚举类型**，不是给 "TestCaseRunResult" ADD VALUE ——
-- 后者会撞上「PG 禁止在同一事务里使用刚添加的 enum 值」。

CREATE TYPE "TestCaseFailureAttribution" AS ENUM (
  'IMPLEMENTATION_DEFECT',
  'CASE_OUTDATED',
  'EXTERNAL_BLOCK',
  'UNKNOWN'
);

ALTER TABLE "test_case_runs"
  ADD COLUMN "failureAttribution" "TestCaseFailureAttribution";

ALTER TABLE "test_case_runs"
  ADD COLUMN "unprovenVerification" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "test_cases"
  ADD COLUMN "requiredEnvironment" "TestEnvironment";
