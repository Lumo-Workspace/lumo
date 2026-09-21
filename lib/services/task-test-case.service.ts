import type { Prisma } from '@prisma/client'
import { runInTransaction } from '@/lib/db/transaction'
import {
  testCaseRepository,
  type TestCaseRow,
  type TestCaseRunRow,
} from '@/lib/repositories/test-case.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import type {
  CreateTestCaseBody,
  UpdateTestCaseBody,
  RecordRunBody,
} from '@/lib/validation/test-case'

export interface TestCaseAttribution {
  /** WorkspaceMember id of the caller. */
  actorMemberId: string
  /** Claude Code session the write came from, when the caller sent the header. */
  sourceSessionId: string | null
}

export interface TaskPullRequestSnapshot {
  id: string
  number: number
  title: string
  url: string
  state: string
  headSha: string | null
  mergeCommitSha: string | null
}

export type TestCaseWithLatestRun = TestCaseRow & {
  latestRun: TestCaseRunRow | null
}

export type RunFreshness =
  | { state: 'fresh'; currentSha: string }
  | { state: 'stale'; currentSha: string }
  | { state: 'dirty'; currentSha: string | null }
  | { state: 'unknown'; currentSha: string | null }

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status })
}

const VALID_ENVIRONMENTS = ['LOCAL', 'PREVIEW', 'PRODUCTION'] as const

/**
 * 这条 run 验的还是 PR 现在的代码吗？
 *
 * **Fail-closed**：缺任何一半（run 没记 sha、PR 的 head 还没同步到、run 压根没绑
 * PR）一律 `unknown`，**绝不**乐观地报 `fresh`。一个假的 `fresh` 比一个诚实的
 * `unknown` 危险得多——前者会让人以为验过了。
 *
 * `commitDirty` 优先于一切：跑的时候工作区是脏的，那个 sha 就不代表被测代码，
 * 哪怕它和 PR head 一模一样也不算 fresh。
 *
 * PR 已合并时比的是 `mergeCommitSha`：生产环境那次执行对应的是合并 commit，
 * 不是 PR 头。
 *
 * 纯函数，**不落列**：存一个 isStale，PR 一 push 它就开始撒谎。
 */
export function deriveRunFreshness(
  run: Pick<TestCaseRunRow, 'pullRequestId' | 'commitSha' | 'commitDirty'>,
  pr: TaskPullRequestSnapshot | null
): RunFreshness {
  const current =
    pr === null
      ? null
      : pr.state === 'merged'
        ? (pr.mergeCommitSha ?? pr.headSha)
        : pr.headSha

  if (run.commitDirty === true) return { state: 'dirty', currentSha: current }
  if (!run.pullRequestId || !run.commitSha || !current)
    return { state: 'unknown', currentSha: current }

  return run.commitSha === current
    ? { state: 'fresh', currentSha: current }
    : { state: 'stale', currentSha: current }
}

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
    testCases: TestCaseWithLatestRun[]
    pullRequests: TaskPullRequestSnapshot[]
  }> {
    const [cases, latest, pullRequests] = await Promise.all([
      testCaseRepository.listForTask(taskId),
      testCaseRepository.latestRunPerCase(taskId),
      testCaseRepository.listTaskPullRequests(taskId),
    ])
    return {
      testCases: cases.map(c => ({
        ...c,
        latestRun: latest.get(c.id) ?? null,
      })),
      pullRequests,
    }
  },

  async getDetail(testCaseId: string): Promise<{
    testCase: TestCaseRow
    runs: TestCaseRunRow[]
    pullRequests: TaskPullRequestSnapshot[]
  }> {
    const testCase = await testCaseRepository.findById(testCaseId)
    if (!testCase) fail('Test case not found', 404)
    const [runs, pullRequests] = await Promise.all([
      testCaseRepository.listRuns(testCaseId),
      testCaseRepository.listTaskPullRequests(testCase.taskId),
    ])
    // 陈旧性在**读端**推导（deriveRunFreshness），不落列。
    return { testCase, runs, pullRequests }
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

  /** Append 一条执行记录。**没有对应的 update / delete**。 */
  async recordRun(
    testCase: TestCaseRow,
    body: RecordRunBody,
    attribution: TestCaseAttribution
  ): Promise<{ run: TestCaseRunRow }> {
    // environment 没有默认值。Zod 已挡住大多数情况，这里是 service 侧的
    // 独立闸门（内部调用方绕过 route 时同样受约束）。
    if (!body.environment || !VALID_ENVIRONMENTS.includes(body.environment)) {
      fail(
        'environment is required (LOCAL | PREVIEW | PRODUCTION) — there is no default.',
        400
      )
    }

    const locator = resolveLocator(testCase, body)

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
          },
        },
        tx
      )
      return created
    })
    return { run }
  },
}
