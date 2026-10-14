import type { Prisma, TestCaseFailureAttribution } from '@prisma/client'
import { runInTransaction } from '@/lib/db/transaction'
import {
  testCaseRepository,
  type TestCaseRow,
  type TestCaseRunRow,
} from '@/lib/repositories/test-case.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
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
import {
  countEvidence,
  deriveRunCeiling,
  type RunCeiling,
} from '@/lib/test-cases/provability'
import type { StoredStepResult } from '@/lib/test-cases/step-report'

export { deriveRunFreshness, type RunFreshness, type TaskPullRequestSnapshot }
export { deriveRunCeiling, type RunCeiling }

export interface TestCaseAttribution {
  /** WorkspaceMember id of the caller. */
  actorMemberId: string
  /** Claude Code session the write came from, when the caller sent the header. */
  sourceSessionId: string | null
}

/**
 * 列表里的一条用例，带它**全部**的执行记录（新到旧）。
 *
 * 卡片上的区域叫「Run history」，就得给得出全部历史——只给最近一条会让标题
 * 撒谎（LUM-801 的 TC1 就是这么 FAIL 的）。
 */
export type TestCaseWithRuns = TestCaseRow & {
  /** LUM-819 返工：每条 run 带上它的最新抽查复核（null = 没人抽到过）。 */
  runs: Array<TestCaseRunWithExecutor & { review: RunReviewSummary | null }>
}

/**
 * LUM-1008：run 带上执行人的显示名。null = 这条 run 没记执行人（读作「未记录」，
 * 不是「没人」）。区分人手动 / agent 代跑看 `sourceSessionId` 是否为空——CLI
 * 跑的 run 记下的成员是 token 主人。
 */
export type TestCaseRunWithExecutor = TestCaseRunRow & {
  executedBy: string | null
}

/**
 * 一批 run 的执行人一次批量解析（同复核人 reviewer 的解析路径），返回 run →
 * 显示名。成员已被清理时 labelsByIds 兜底成 member id，照常显示。
 */
async function executorResolver(
  runs: TestCaseRunRow[]
): Promise<(run: TestCaseRunRow) => string | null> {
  const labels = await memberRepository.labelsByIds([
    ...new Set(
      runs.flatMap(r => (r.executedByMemberId ? [r.executedByMemberId] : []))
    ),
  ])
  return run =>
    run.executedByMemberId
      ? (labels.get(run.executedByMemberId) ?? run.executedByMemberId)
      : null
}

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status })
}

/** LUM-1135: task routes only ever resolve task-owned cases; a milestone case here is a 404. */
export function taskIdOf(row: { taskId: string | null }): string {
  if (row.taskId === null) fail('Test case not found', 404)
  return row.taskId
}

const VALID_ENVIRONMENTS = ['LOCAL', 'PREVIEW', 'PRODUCTION'] as const

/**
 * 校验失败定位并返回要快照的原文。
 *
 * 规则（红线，勿「顺手放宽」）：
 * - 只有 FAIL 携带定位。BLOCKED 的语义是「前置条件/环境不满足，用例根本没跑
 *   起来」，没跑起来就没有「挂在第几步」；跑到一半被外部卡住应记 FAIL + 定位。
 * - phase 与 index 同生同死，不接受只给一个。
 * - index 必须落在该段数组的范围内。
 */
function resolveLocator(
  testCase: TestCaseRow,
  body: RecordRunBody
): {
  failedPhase: RecordRunBody['failedPhase']
  failedIndex: number | null
  failedStepText: string | null
} {
  const phase = body.failedPhase ?? null
  const index = body.failedIndex ?? null

  if (phase === null && index === null) {
    return { failedPhase: null, failedIndex: null, failedStepText: null }
  }
  if (body.result !== 'FAIL') {
    fail(
      `A ${body.result} run cannot carry a failure locator (only FAIL can).`,
      400
    )
  }
  if (phase === null || index === null) {
    fail('failedPhase and failedIndex must be provided together.', 400)
  }

  const list = phase === 'STEPS' ? testCase.steps : testCase.verification
  if (index < 0 || index >= list.length) {
    fail(
      `failedIndex ${index} is out of range for ${phase} (length ${list.length}).`,
      400
    )
  }
  return {
    failedPhase: phase,
    failedIndex: index,
    failedStepText: list[index]!,
  }
}

/**
 * LUM-808 步骤 1：校验 FAIL 的归因。
 *
 * 红线（勿「顺手放宽」）：
 * - 只有 FAIL 谈「谁的锅」。PASS / BLOCKED 带归因即 400。
 * - FAIL 必须归因。`UNKNOWN` 是合法答案——逼出一个乱填的归因只会污染统计。
 * - **不对称的举证责任**：只有 IMPLEMENTATION_DEFECT 需要至少一条 evidence。
 *   另两类是「我没能证明」，举证责任轻。这一条同时是「先落证据、再下结论」
 *   的强制点：想说是实现的锅，就不能凭「我记得当时是这样」。
 */
function resolveAttribution(
  body: RecordRunBody
): TestCaseFailureAttribution | null {
  const attribution = body.failureAttribution ?? null

  if (body.result !== 'FAIL') {
    if (attribution !== null) {
      fail(
        `A ${body.result} run cannot carry a failure attribution (only FAIL can).`,
        400
      )
    }
    return null
  }
  if (attribution === null) {
    fail(
      'A FAIL run must say whose fault it is: failureAttribution is one of ' +
        'IMPLEMENTATION_DEFECT | CASE_OUTDATED | EXTERNAL_BLOCK | UNKNOWN.',
      400
    )
  }
  if (
    attribution === 'IMPLEMENTATION_DEFECT' &&
    (body.evidence ?? []).length === 0
  ) {
    fail(
      'IMPLEMENTATION_DEFECT needs at least one evidence entry — claiming the ' +
        'implementation is at fault is the one attribution that carries a burden ' +
        'of proof. Attach evidence, or record CASE_OUTDATED / EXTERNAL_BLOCK / UNKNOWN.',
      400
    )
  }
  return attribution
}

/**
 * LUM-808 步骤 2：把「本次没能观察到的复验条目」下标解析成带原文快照的条目。
 *
 * 快照原文的理由同 failedStepText：用例后来被改写，这条 run 仍读得懂。
 * 下标必须落在该用例 verification[] 的范围内；重复下标去重（同一条说两遍
 * 不增加信息，却会让读端的计数撒谎）。
 */
function resolveUnproven(
  testCase: TestCaseRow,
  body: RecordRunBody
): Array<{ index: number; text: string }> {
  const raw = body.unprovenVerification ?? []
  if (raw.length === 0) return []

  const seen = new Set<number>()
  const out: Array<{ index: number; text: string }> = []
  for (const index of raw) {
    if (index < 0 || index >= testCase.verification.length) {
      fail(
        `unprovenVerification index ${index} is out of range for VERIFICATION ` +
          `(length ${testCase.verification.length}).`,
        400
      )
    }
    if (seen.has(index)) continue
    seen.add(index)
    out.push({ index, text: testCase.verification[index]! })
  }
  return out
}

/**
 * LUM-1011: 校验逐步结果并快照原文。
 *
 * 红线（勿「顺手放宽」）：
 * - BLOCKED 不带逐步结果——用例根本没跑起来。
 * - 只有 FAIL 能带 FAIL 步，且至多一条；它必须与 failedPhase/failedIndex 一致。
 *   FAIL 步在而定位缺省时，定位由它补齐（调用方只说一遍）。
 * - 失败点之后不得有 PASS：「断在第 4 步」意味着后面没跑到。
 * - 同一步不得报两次；下标落在该段范围内；evidence 下标落在本次证据范围内。
 */
function resolveStepResults(
  testCase: TestCaseRow,
  body: RecordRunBody,
  locator: ReturnType<typeof resolveLocator>
): {
  stepResults: StoredStepResult[]
  locator: ReturnType<typeof resolveLocator>
} {
  const raw = body.stepResults ?? []
  if (raw.length === 0) return { stepResults: [], locator }
  if (body.result === 'BLOCKED') {
    fail(
      'A BLOCKED run cannot carry step results — the case never ran. Use FAIL with the failing step instead.',
      400
    )
  }

  const evidenceCount = (body.evidence ?? []).length
  const seen = new Set<string>()
  const out: StoredStepResult[] = []
  for (const r of raw) {
    const list = r.phase === 'STEPS' ? testCase.steps : testCase.verification
    if (r.index >= list.length) {
      fail(
        `stepResults index ${r.index} is out of range for ${r.phase} (length ${list.length}).`,
        400
      )
    }
    const key = `${r.phase}:${r.index}`
    if (seen.has(key)) {
      fail(`stepResults reports ${r.phase} ${r.index} more than once.`, 400)
    }
    seen.add(key)
    for (const e of r.evidence ?? []) {
      if (e >= evidenceCount) {
        fail(
          `stepResults evidence index ${e} is out of range (this run has ${evidenceCount} evidence entries).`,
          400
        )
      }
    }
    out.push({
      phase: r.phase,
      index: r.index,
      text: list[r.index]!,
      status: r.status,
      durationMs: r.durationMs ?? null,
      evidence: [...new Set(r.evidence ?? [])],
    })
  }

  const fails = out.filter(r => r.status === 'FAIL')
  if (fails.length > 0 && body.result !== 'FAIL') {
    fail(`A ${body.result} run cannot report a failing step.`, 400)
  }
  if (fails.length > 1) {
    fail('At most one step can FAIL — a run breaks at one place.', 400)
  }

  let resolved = locator
  const failing = fails[0]
  if (failing) {
    if (locator.failedPhase === null) {
      resolved = {
        failedPhase: failing.phase,
        failedIndex: failing.index,
        failedStepText: failing.text,
      }
    } else if (
      locator.failedPhase !== failing.phase ||
      locator.failedIndex !== failing.index
    ) {
      fail(
        'The failing step in stepResults does not match failedPhase/failedIndex.',
        400
      )
    }
  }

  if (resolved.failedPhase != null && resolved.failedIndex !== null) {
    const stepCount = testCase.steps.length
    const pos = (phase: string, index: number) =>
      phase === 'STEPS' ? index : stepCount + index
    const failPos = pos(resolved.failedPhase, resolved.failedIndex)
    const late = out.find(
      r => r.status === 'PASS' && pos(r.phase, r.index) > failPos
    )
    if (late) {
      fail(
        `${late.phase} ${late.index} is reported PASS after the run broke — steps after the failure were not reached.`,
        400
      )
    }
  }

  return { stepResults: out, locator: resolved }
}

/** LUM-1011: 实际观察只属于 FAIL（PASS 的「实际」就是期望本身）。 */
function resolveActual(body: RecordRunBody): string | null {
  const actual = body.actual ?? null
  if (actual !== null && body.result !== 'FAIL') {
    fail(
      `A ${body.result} run cannot carry an actual result (only FAIL can).`,
      400
    )
  }
  return actual
}

async function resolveActorId(memberId: string): Promise<string | null> {
  const actor = await memberRepository.findActorByMemberId(memberId)
  return actor?.id ?? null
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
    return {
      testCases: cases.map(c => ({
        ...c,
        runs: (runs.get(c.id) ?? []).map(r => ({
          ...r,
          executedBy: executedBy(r),
          review: reviews.get(r.id) ?? null,
        })),
      })),
      pullRequests,
    }
  },

  async getDetail(testCaseId: string): Promise<{
    testCase: TestCaseRow
    runs: TestCaseRunWithExecutor[]
    pullRequests: TaskPullRequestSnapshot[]
  }> {
    const testCase = await testCaseRepository.findById(testCaseId)
    if (!testCase) fail('Test case not found', 404)
    const [runs, pullRequests] = await Promise.all([
      testCaseRepository.listRuns(testCaseId),
      testCaseRepository.listTaskPullRequests(taskIdOf(testCase)),
    ])
    // 陈旧性在**读端**推导（deriveRunFreshness），不落列。
    const executedBy = await executorResolver(runs)
    return {
      testCase,
      runs: runs.map(r => ({ ...r, executedBy: executedBy(r) })),
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
    // environment 没有默认值。Zod 已挡住大多数情况，这里是 service 侧的
    // 独立闸门（内部调用方绕过 route 时同样受约束）。
    if (!body.environment || !VALID_ENVIRONMENTS.includes(body.environment)) {
      fail(
        'environment is required (LOCAL | PREVIEW | PRODUCTION) — there is no default.',
        400
      )
    }

    const { stepResults, locator } = resolveStepResults(
      testCase,
      body,
      resolveLocator(testCase, body)
    )
    const actual = resolveActual(body)
    const failureAttribution = resolveAttribution(body)
    const unprovenVerification = resolveUnproven(testCase, body)

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
          failedPhase: locator.failedPhase ?? null,
          failedIndex: locator.failedIndex,
          failedStepText: locator.failedStepText,
          failureAttribution,
          unprovenVerification:
            unprovenVerification as unknown as Prisma.InputJsonValue,
          evidence: (body.evidence ?? []) as unknown as Prisma.InputJsonValue,
          stepResults: stepResults as unknown as Prisma.InputJsonValue,
          actual,
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
            failureAttribution,
          },
        },
        tx
      )
      return created
    })
    return {
      run,
      ceiling: deriveRunCeiling(
        {
          result: run.result,
          environment: run.environment,
          unprovenVerification,
          evidenceCount: countEvidence(run.evidence),
        },
        { requiredEnvironment: testCase.requiredEnvironment }
      ),
    }
  },
}
