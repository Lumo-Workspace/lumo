import type { Prisma, TestCaseFailureAttribution } from '@prisma/client'
import { runInTransaction } from '@/lib/db/transaction'
import {
  testCaseRepository,
  type TestCaseRow,
  type TestCaseRunRow,
} from '@/lib/repositories/test-case.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
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
  runs: TestCaseRunRow[]
}

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status })
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

async function resolveActorId(memberId: string): Promise<string | null> {
  const actor = await memberRepository.findActorByMemberId(memberId)
  return actor?.id ?? null
}

/**
 * LUM-815: 覆盖声明必须指向**同一个任务**合同里的一条 active 标准。
 *
 * 未声明（null / 省略）直接放行——那是合法的常态，不是需要解释的例外。
 * 跨任务引用则一律 422：它不只是「少见」，而是会让覆盖缺口算到别的任务头上，
 * 把这个功能唯一的产出（哪条标准没人验过）直接变成噪音。
 *
 * 指向**已软删**的标准同样拒绝：listByTask 只返回 active 行。已经绑好的用例
 * 在标准事后被软删时照常保留引用（那是历史，读端渲染成「该标准已变更」），
 * 但**新**建立一条指向墓碑的引用没有任何意义。
 */
async function assertCriterionOnTask(
  taskId: string,
  criterionId: string | null | undefined
): Promise<void> {
  if (criterionId === null || criterionId === undefined) return
  const criteria = await acceptanceCriterionRepository.listByTask(taskId)
  if (!criteria.some(c => c.id === criterionId)) {
    fail(
      `Criterion ${criterionId} is not in this task's acceptance contract`,
      422
    )
  }
}

/**
 * LUM-815 follow-up: 用例声明覆盖的那条标准，**连同它还在不在当前合同里**。
 *
 * 为什么需要 `removed`：一条有 verification run 的 criterion 被移出合同时是
 * **软删**（墓碑留着，裁定链不能断），用例的引用于是照旧指向它。那不是脏
 * 数据，是历史——但如果读出来只有一个裸 id，读的人会拿它去 `criteria list`
 * 里找，然后找不到。所以这里把「它已经不在合同里了」一并读出来。
 *
 * 硬删（run-free 的 criterion）走的是另一条路：DB 的 `ON DELETE SET NULL`
 * 会把引用置空，所以这里直接是 null——「没声明」与「声明的对象没了」在读出
 * 面是同一种呈现，因为库里本来就分不出来了。
 */
export interface LinkedCriterion {
  id: string
  statement: string
  /** true = 已不在当前合同里（软删墓碑）。 */
  removed: boolean
}

async function resolveLinkedCriterion(
  taskId: string,
  criterionId: string | null
): Promise<LinkedCriterion | null> {
  if (!criterionId) return null
  const all =
    await acceptanceCriterionRepository.listByTaskIncludingDeleted(taskId)
  const row = all.find(c => c.id === criterionId)
  if (!row) return null
  return {
    id: row.id,
    statement: row.statement,
    removed: row.deletedAt !== null,
  }
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
    const [cases, runs, pullRequests] = await Promise.all([
      testCaseRepository.listForTask(taskId),
      testCaseRepository.runsPerCase(taskId),
      testCaseRepository.listTaskPullRequests(taskId),
    ])
    return {
      testCases: cases.map(c => ({ ...c, runs: runs.get(c.id) ?? [] })),
      pullRequests,
    }
  },

  async getDetail(testCaseId: string): Promise<{
    testCase: TestCaseRow
    runs: TestCaseRunRow[]
    pullRequests: TaskPullRequestSnapshot[]
    criterion: LinkedCriterion | null
  }> {
    const testCase = await testCaseRepository.findById(testCaseId)
    if (!testCase) fail('Test case not found', 404)
    const [runs, pullRequests, criterion] = await Promise.all([
      testCaseRepository.listRuns(testCaseId),
      testCaseRepository.listTaskPullRequests(testCase.taskId),
      resolveLinkedCriterion(testCase.taskId, testCase.criterionId),
    ])
    // 陈旧性在**读端**推导（deriveRunFreshness），不落列。
    return { testCase, runs, pullRequests, criterion }
  },

  async create(
    taskId: string,
    body: CreateTestCaseBody,
    attribution: TestCaseAttribution
  ): Promise<{ testCase: TestCaseRow }> {
    await assertCriterionOnTask(taskId, body.criterionId)
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
          criterionId: body.criterionId ?? null,
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
    await assertCriterionOnTask(existing.taskId, body.criterionId)
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
          // LUM-815: null = 解绑，字符串 = 改绑，省略 = 不动。三态都要留住,
          // 所以这里判的是 `!== undefined` 而不是真值。
          ...(body.criterionId !== undefined
            ? { criterionId: body.criterionId ?? null }
            : {}),
        },
        tx
      )
      await activityRepository.create(
        {
          taskId: existing.taskId,
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
          taskId: existing.taskId,
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

    const locator = resolveLocator(testCase, body)
    const failureAttribution = resolveAttribution(body)
    const unprovenVerification = resolveUnproven(testCase, body)

    // PR 按**号**上线，在这里按任务作用域解析成 id。号必须属于这个任务——
    // 不做跨任务引用，否则陈旧性比较会拿错 head。
    let pullRequestId: string | null = null
    if (body.pullRequestNumber != null) {
      const prs = await testCaseRepository.listTaskPullRequests(testCase.taskId)
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
          taskId: testCase.taskId,
          result: body.result,
          environment: body.environment,
          failedPhase: locator.failedPhase ?? null,
          failedIndex: locator.failedIndex,
          failedStepText: locator.failedStepText,
          failureAttribution,
          unprovenVerification:
            unprovenVerification as unknown as Prisma.InputJsonValue,
          evidence: (body.evidence ?? []) as unknown as Prisma.InputJsonValue,
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
          taskId: testCase.taskId,
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
