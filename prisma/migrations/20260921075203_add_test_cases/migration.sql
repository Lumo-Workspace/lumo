-- LUM-801: 任务级 test case（用例定义 + append-only 执行记录）
--
-- 手写而非 `prisma migrate dev` 生成：本地 dev DB 已与迁移历史分叉
-- （P3008/P3012），按 CLAUDE.md 的流程 db execute + migrate resolve --applied。
--
-- ⚠ 下面对 "TaskActivityType" 用的是 ALTER TYPE ... ADD VALUE。PostgreSQL
--   **不允许在同一事务内使用**刚添加的枚举值。本迁移不写任何 activity 行，
--   因此安全。后人不要在这个迁移里 seed 使用这些新值的行。

-- CreateEnum
CREATE TYPE "TestEnvironment" AS ENUM ('LOCAL', 'PREVIEW', 'PRODUCTION');
CREATE TYPE "TestCaseRunResult" AS ENUM ('PASS', 'FAIL', 'BLOCKED');
CREATE TYPE "TestCasePhase" AS ENUM ('STEPS', 'VERIFICATION');

-- AlterEnum
ALTER TYPE "TaskActivityType" ADD VALUE 'TEST_CASE_ADDED';
ALTER TYPE "TaskActivityType" ADD VALUE 'TEST_CASE_UPDATED';
ALTER TYPE "TaskActivityType" ADD VALUE 'TEST_CASE_REMOVED';
ALTER TYPE "TaskActivityType" ADD VALUE 'TEST_CASE_RUN_RECORDED';

-- AlterTable: PR 的当前 head commit（LUM-801 陈旧性判定的前提）。
-- 可空且**不回填**——历史 PR 当时的 head 无从追溯，留 null 让它落在 `unknown`
-- 是诚实的；伪造一个值会让陈旧性判定撒谎。
ALTER TABLE "pull_requests" ADD COLUMN "headSha" TEXT;

-- CreateTable
CREATE TABLE "test_cases" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "setup" TEXT,
    "steps" TEXT[],
    "verification" TEXT[],
    "expected" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_case_runs" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "result" "TestCaseRunResult" NOT NULL,
    "environment" "TestEnvironment" NOT NULL,
    "failedPhase" "TestCasePhase",
    "failedIndex" INTEGER,
    "failedStepText" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "pullRequestId" TEXT,
    "commitSha" TEXT,
    "commitDirty" BOOLEAN,
    "executedByMemberId" TEXT,
    "sourceSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_case_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "test_cases_taskId_number_key" ON "test_cases"("taskId", "number");
CREATE INDEX "test_cases_taskId_deletedAt_idx" ON "test_cases"("taskId", "deletedAt");
CREATE INDEX "test_case_runs_testCaseId_createdAt_idx" ON "test_case_runs"("testCaseId", "createdAt");
CREATE INDEX "test_case_runs_taskId_createdAt_idx" ON "test_case_runs"("taskId", "createdAt");
CREATE INDEX "test_case_runs_pullRequestId_idx" ON "test_case_runs"("pullRequestId");

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_case_runs" ADD CONSTRAINT "test_case_runs_testCaseId_fkey"
  FOREIGN KEY ("testCaseId") REFERENCES "test_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_case_runs" ADD CONSTRAINT "test_case_runs_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_case_runs" ADD CONSTRAINT "test_case_runs_pullRequestId_fkey"
  FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
