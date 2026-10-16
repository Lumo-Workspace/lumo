import type { Prisma } from '@prisma/client'
import { runInTransaction } from '@/lib/db/transaction'
import {
  testCaseRepository,
  type TestCaseRow,
  type TestCaseRunRow,
} from '@/lib/repositories/test-case.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import {
  testCaseReviewService,
  type RunReviewSummary,
} from '@/lib/services/test-case-review.service'
import type {
  CreateTestCaseBody,
  UpdateTestCaseBody,
  RecordRunBody,
} from '@/lib/validation/test-case'
// 陈旧性推导住在一个**不碰 prisma** 的纯模块里，客户端组件才能直接 import 它
// （从这里 import 会把 Prisma + pg 拖进浏览器 bundle）。这里 re-export 只是
// 为了服务端调用方的便利。
import {
  deriveRunFreshness,
  type RunFreshness,
  type TaskPullRequestSnapshot,
} from '@/lib/test-cases/freshness'
import { deriveRunCeiling, type RunCeiling } from '@/lib/test-cases/provability'
import {
  ceilingOf,
  executorResolver,
  fail,
  resolveActorId,
  resolveRunFields,
  runVerdictOf,
  type RunVerdict,
  type TestCaseAttribution,
  type TestCaseRunWithExecutor,
} from '@/lib/services/test-case-core'
import {
  summarizeTestCases,
  type TestCasesSummary,
} from '@/lib/test-cases/case-summary'

export { deriveRunFreshness, type RunFreshness, type TaskPullRequestSnapshot }
export { deriveRunCeiling, type RunCeiling }
export type { TestCaseAttribution, TestCaseRunWithExecutor }

/**
 * 列表里的一条用例，带它**全部**的执行记录（新到旧）。
 *
 * 卡片上的区域叫「Run history」，就得给得出全部历史——只给最近一条会让标题
 * 撒谎（LUM-801 的 TC1 就是这么 FAIL 的）。
 */
export type TestCaseWithRuns = TestCaseRow & {
  /**
   * LUM-819 返工：每条 run 带上它的最新抽查复核（null = 没人抽到过）。
   * LUM-1185：再带上推导出的封顶结论与逐步报告（RunVerdict）。
   */
  runs: TaskTestCaseRunView[]
}

/** 读端的一条 run：落库列 + 执行人 + 复核 + 推导判定（LUM-1185）。 */
export type TaskTestCaseRunView = TestCaseRunWithExecutor &
  RunVerdict & { review: RunReviewSummary | null }

/** LUM-1135: task routes only ever resolve task-owned cases; a milestone case here is a 404. */
export function taskIdOf(row: { taskId: string | null }): string {
  if (row.taskId === null) fail('Test case not found', 404)
  return row.taskId
}

/**
 * LUM-801: 任务级 test case 的业务规则层。
 *
 * 注意这里**没有** updateRun / deleteRun —— run 是 append-only 事件日志，
 * 纠正一次误记的办法是再 append 一条，不是改写历史。别加。
 */
export const taskTestCaseService = {
  async listForTask(taskId: string): Promise<{
    testCases: TestCaseWithRuns[]
    pullRequests: TaskPullRequestSnapshot[]
    /** LUM-1185: 与 web Record 行同源的汇总（N/M passing、拦 DONE 的缺陷）。 */
    summary: TestCasesSummary
  }> {
    const runsPromise = testCaseRepository.runsPerCase(taskId)
    // 执行人解析只依赖 runs，与其余读并行，不在它们之后再串一次 Clerk 往返。
    const [cases, runs, executedBy, pullRequests, reviews] = await Promise.all([
      testCaseRepository.listForTask(taskId),
      runsPromise,
      (async () =>
        executorResolver([...(await runsPromise).values()].flat()))(),
      testCaseRepository.listTaskPullRequests(taskId),
      testCaseReviewService.latestForTask(taskId),
    ])
    const testCases = cases.map(c => ({
      ...c,
      runs: (runs.get(c.id) ?? []).map(r => ({
        ...r,
        executedBy: executedBy(r),
        review: reviews.get(r.id) ?? null,
        ...runVerdictOf(r, c),
      })),
    }))
    return {
      testCases,
      pullRequests,
      summary: summarizeTestCases(testCases),
    }
  },

  async getDetail(testCaseId: string): Promise<{
    testCase: TestCaseRow
    runs: TaskTestCaseRunView[]
    pullRequests: TaskPullRequestSnapshot[]
  }> {
    const testCase = await testCaseRepository.findById(testCaseId)
    if (!testCase) fail('Test case not found', 404)
    const taskId = taskIdOf(testCase)
    const [runs, pullRequests, reviews] = await Promise.all([
      testCaseRepository.listRuns(testCaseId),
      testCaseRepository.listTaskPullRequests(taskId),
      testCaseReviewService.latestForTask(taskId),
    ])
    // 陈旧性在**读端**推导（deriveRunFreshness），不落列。
    const executedBy = await executorResolver(runs)
    return {
      testCase,
      runs: runs.map(r => ({
        ...r,
        executedBy: executedBy(r),
        // LUM-1185: 详情与列表同一份读端形状——复核 + 推导判定。
        review: reviews.get(r.id) ?? null,
        ...runVerdictOf(r, testCase),
      })),
      pullRequests,
    }
  },

  async create(
    taskId: string,
    body: CreateTestCaseBody,
    attribution: TestCaseAttribution
  ): Promise<{ testCase: TestCaseRow }> {
    const actorId = await resolveActorId(attribution.actorMemberId)
    const testCase = await runInTransaction(async tx => {
      const created = await testCaseRepository.createWithNumber(
        {
          taskId,
          title: body.title,
          setup: body.setup ?? null,
          steps: body.steps,
          verification: body.verification,
          expected: body.expected,
          requiredEnvironment: body.requiredEnvironment ?? null,
        },
        tx
      )
      await activityRepository.create(
        {
          taskId,
          actorId,
          type: 'TEST_CASE_ADDED',
          payload: {
            testCaseId: created.id,
            number: created.number,
            title: created.title,
          },
        },
        tx
      )
      return created
    })
    return { testCase }
  },

  async update(
    testCaseId: string,
    body: UpdateTestCaseBody,
    attribution: TestCaseAttribution
  ): Promise<{ testCase: TestCaseRow }> {
    const existing = await testCaseRepository.findById(testCaseId)
    if (!existing) fail('Test case not found', 404)
    const actorId = await resolveActorId(attribution.actorMemberId)

    const testCase = await runInTransaction(async tx => {
      const updated = await testCaseRepository.update(
        testCaseId,
        {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.setup !== undefined ? { setup: body.setup ?? null } : {}),
          ...(body.steps !== undefined ? { steps: body.steps } : {}),
          ...(body.verification !== undefined
            ? { verification: body.verification }
            : {}),
          ...(body.expected !== undefined ? { expected: body.expected } : {}),
          ...(body.requiredEnvironment !== undefined
            ? { requiredEnvironment: body.requiredEnvironment ?? null }
            : {}),
        },
        tx
      )
      await activityRepository.create(
        {
          taskId: taskIdOf(existing),
          actorId,
          type: 'TEST_CASE_UPDATED',
          payload: {
            testCaseId,
            number: existing.number,
            before: {
              title: existing.title,
              steps: existing.steps,
              verification: existing.verification,
            },
            after: {
              title: updated.title,
              steps: updated.steps,
              verification: updated.verification,
            },
          },
        },
        tx
      )
      return updated
    })
    return { testCase }
  },

  async remove(
    testCaseId: string,
    attribution: TestCaseAttribution
  ): Promise<void> {
    const existing = await testCaseRepository.findById(testCaseId)
    if (!existing) fail('Test case not found', 404)
    const actorId = await resolveActorId(attribution.actorMemberId)

    await runInTransaction(async tx => {
      await testCaseRepository.softDelete(testCaseId, tx)
      await activityRepository.create(
        {
          taskId: taskIdOf(existing),
          actorId,
          type: 'TEST_CASE_REMOVED',
          payload: {
            testCaseId,
            number: existing.number,
            title: existing.title,
          },
        },
        tx
      )
    })
  },

  /**
   * Append 一条执行记录。**没有对应的 update / delete**。
   *
   * 返回值带上 `ceiling`（LUM-808）：封顶后的结论是**推导**出来的、不落列，
   * 但调用方需要它才能当场把降级摆到用户脸上。推导在这里做一次，CLI 与 web
   * 都只渲染，不重算——一份规则一处实现。
   */
  async recordRun(
    testCase: TestCaseRow,
    body: RecordRunBody,
    attribution: TestCaseAttribution
  ): Promise<{ run: TestCaseRunRow; ceiling: RunCeiling }> {
    const fields = resolveRunFields(testCase, body)

    // PR 按**号**上线，在这里按任务作用域解析成 id。号必须属于这个任务——
    // 不做跨任务引用，否则陈旧性比较会拿错 head。
    let pullRequestId: string | null = null
    if (body.pullRequestNumber != null) {
      const prs = await testCaseRepository.listTaskPullRequests(
        taskIdOf(testCase)
      )
      const match = prs.find(pr => pr.number === body.pullRequestNumber)
      if (!match) {
        fail(
          `Pull request #${body.pullRequestNumber} is not linked to this task.`,
          400
        )
      }
      pullRequestId = match.id
    }

    const actorId = await resolveActorId(attribution.actorMemberId)

    const run = await runInTransaction(async tx => {
      const created = await testCaseRepository.createRun(
        {
          testCaseId: testCase.id,
          taskId: taskIdOf(testCase),
          result: body.result,
          environment: body.environment,
          failedPhase: fields.failedPhase,
          failedIndex: fields.failedIndex,
          failedStepText: fields.failedStepText,
          failureAttribution: fields.failureAttribution,
          unprovenVerification:
            fields.unprovenVerification as unknown as Prisma.InputJsonValue,
          evidence: (body.evidence ?? []) as unknown as Prisma.InputJsonValue,
          stepResults: fields.stepResults as unknown as Prisma.InputJsonValue,
          actual: fields.actual,
          note: body.note ?? null,
          pullRequestId,
          commitSha: body.commitSha ?? null,
          // null 是「未知」，不是「干净」——不要 ?? false。
          commitDirty: body.commitDirty ?? null,
          executedByMemberId: attribution.actorMemberId,
          sourceSessionId: attribution.sourceSessionId,
        },
        tx
      )
      await activityRepository.create(
        {
          taskId: taskIdOf(testCase),
          actorId,
          type: 'TEST_CASE_RUN_RECORDED',
          payload: {
            testCaseId: testCase.id,
            number: testCase.number,
            runId: created.id,
            result: created.result,
            environment: created.environment,
            failureAttribution: fields.failureAttribution,
          },
        },
        tx
      )
      return created
    })
    return {
      run,
      ceiling: ceilingOf(run, fields.unprovenVerification, testCase),
    }
  },
}
