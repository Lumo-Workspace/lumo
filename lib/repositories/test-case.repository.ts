import { prisma } from '@/lib/db/prisma'
import { activityRepository } from '@/lib/repositories/activity.repository'
import type {
  Prisma,
  TestCaseFailureAttribution,
  TestCasePhase,
  TestCaseRunResult,
  TestEnvironment,
} from '@prisma/client'
import {
  redactStoredFields,
  STORAGE_REDACTED_FIELDS,
} from '@/lib/security-scan/storage-redaction'

interface CreateTestCaseFields {
  title: string
  setup: string | null
  steps: string[]
  verification: string[]
  expected: string
  /** LUM-808: 省略 / null = 不限。与 run 的 environment 不同，这里「不限」
   *  是有意义的默认，不需要逼调用方表态。 */
  requiredEnvironment?: TestEnvironment | null
}

/** LUM-1135: a case belongs to exactly one task or one milestone (DB CHECK). */
export type CreateTestCaseInput = CreateTestCaseFields &
  (
    | { taskId: string; milestoneId?: undefined }
    | { milestoneId: string; taskId?: undefined }
  )

function ownerWhere(input: {
  taskId?: string | undefined
  milestoneId?: string | undefined
}) {
  return input.taskId !== undefined
    ? { taskId: input.taskId }
    : { milestoneId: input.milestoneId! }
}

export interface UpdateTestCaseInput {
  title?: string
  setup?: string | null
  steps?: string[]
  verification?: string[]
  expected?: string
  requiredEnvironment?: TestEnvironment | null
}

export interface CreateRunInput {
  testCaseId: string
  taskId: string | null
  /** LUM-1135 */
  milestoneId?: string | null
  result: TestCaseRunResult
  environment: TestEnvironment
  failedPhase: TestCasePhase | null
  failedIndex: number | null
  failedStepText: string | null
  /** LUM-808: 非 FAIL 必须为 null。 */
  failureAttribution: TestCaseFailureAttribution | null
  /** LUM-808: [{ index, text }]，判决时刻的原文快照。 */
  unprovenVerification: Prisma.InputJsonValue
  evidence: Prisma.InputJsonValue
  /** LUM-1011: 逐步结果 [{ phase, index, text, status, durationMs, evidence }]。 */
  stepResults: Prisma.InputJsonValue
  /** LUM-1011: FAIL 时实际看到的结果。非 FAIL 为 null。 */
  actual: string | null
  note: string | null
  /** 代码坐标（LUM-801）。null = 未记录，不是「没变过」。 */
  pullRequestId: string | null
  commitSha: string | null
  commitDirty: boolean | null
  executedByMemberId: string | null
  sourceSessionId: string | null
}

const caseSelect = {
  id: true,
  taskId: true,
  milestoneId: true,
  number: true,
  title: true,
  setup: true,
  steps: true,
  verification: true,
  expected: true,
  requiredEnvironment: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const

const runSelect = {
  id: true,
  testCaseId: true,
  taskId: true,
  milestoneId: true,
  result: true,
  environment: true,
  failedPhase: true,
  failedIndex: true,
  failedStepText: true,
  failureAttribution: true,
  unprovenVerification: true,
  evidence: true,
  stepResults: true,
  actual: true,
  note: true,
  pullRequestId: true,
  commitSha: true,
  commitDirty: true,
  executedByMemberId: true,
  sourceSessionId: true,
  createdAt: true,
  // LUM-812: 这条 run 的人类裁定（null = 还没人裁）。跟着 run 一起出来是因为
  // 每个读端（DONE 闸、run 历史、CLI show）都要它——分两次查会让「拦不拦」
  // 和「显示什么」读到两个时刻的状态。
  disposition: {
    select: {
      id: true,
      disposition: true,
      note: true,
      dispositionedById: true,
      dispositionedAt: true,
      channel: true,
    },
  },
} as const

const taskPrSelect = {
  id: true,
  number: true,
  title: true,
  url: true,
  state: true,
  headSha: true,
  mergeCommitSha: true,
} as const

export type TestCaseRow = Prisma.TestCaseGetPayload<{
  select: typeof caseSelect
}>
export type TestCaseRunRow = Prisma.TestCaseRunGetPayload<{
  select: typeof runSelect
}>
export type TaskPullRequestRow = Prisma.PullRequestGetPayload<{
  select: typeof taskPrSelect
}>

/** max+1 分配的重试预算（LUM-661 模式）。 */
const NUMBER_RETRIES = 5

function isUniqueCollision(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'P2002'
}

async function groupRuns(
  where: Prisma.TestCaseRunWhereInput
): Promise<Map<string, TestCaseRunRow[]>> {
  const rows = await prisma.testCaseRun.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: runSelect,
  })
  const grouped = new Map<string, TestCaseRunRow[]>()
  for (const r of rows) {
    const list = grouped.get(r.testCaseId)
    if (list) list.push(r)
    else grouped.set(r.testCaseId, [r])
  }
  return grouped
}

/**
 * LUM-801 哑写层：封装 Prisma 查询、返回领域行。**不含业务规则、不做权限校验**
 * （CLAUDE.md 分层）。跨字段一致性与 400 语义在 task-test-case.service.ts。
 */
export const testCaseRepository = {
  /**
   * 分配 owner（task 或 milestone）内 1-based `number` 并创建。并发下两个调用可能算出同一个 max+1，
   * 由 @@unique([taskId, number]) / @@unique([milestoneId, number]) 兜底成 P2002，这里重算后重试。
   */
  async createWithNumber(
    input: CreateTestCaseInput,
    tx?: Prisma.TransactionClient
  ): Promise<TestCaseRow> {
    const client = tx ?? prisma
    const { taskId: _t, milestoneId: _m, ...fields } = input
    let lastError: unknown
    for (let attempt = 0; attempt < NUMBER_RETRIES; attempt++) {
      const agg = await client.testCase.aggregate({
        where: ownerWhere(input),
        _max: { number: true },
      })
      const next = (agg._max.number ?? 0) + 1
      try {
        return await client.testCase.create({
          data: { ...fields, ...ownerWhere(input), number: next },
          select: caseSelect,
        })
      } catch (e) {
        // 只有编号撞车才重试；别的错误立刻抛，不要在重试循环里吞掉。
        if (!isUniqueCollision(e)) throw e
        lastError = e
      }
    }
    throw lastError
  },

  /** 便宜的存在性检查，供 SSR 的 tab 预判用（避免 Tests tab 首帧闪）。 */
  async hasForTask(taskId: string): Promise<boolean> {
    const found = await prisma.testCase.findFirst({
      where: { taskId, deletedAt: null },
      select: { id: true },
    })
    return found !== null
  },

  listForTask(taskId: string): Promise<TestCaseRow[]> {
    return prisma.testCase.findMany({
      where: { taskId, deletedAt: null },
      orderBy: { number: 'asc' },
      select: caseSelect,
    })
  },

  /**
   * LUM-1310: a task's live cases with their newest runs (newest first, at
   * most `runsPerCase` each), only the columns the issue assessment's
   * runtime evidence reads (`test-case-evidence.ts`).
   */
  listForEvidence(taskId: string, runsPerCase: number) {
    return prisma.testCase.findMany({
      where: { taskId, deletedAt: null },
      orderBy: { number: 'asc' },
      select: {
        number: true,
        title: true,
        expected: true,
        requiredEnvironment: true,
        runs: {
          orderBy: { createdAt: 'desc' },
          take: runsPerCase,
          select: {
            result: true,
            environment: true,
            commitSha: true,
            commitDirty: true,
            stepResults: true,
            evidence: true,
            unprovenVerification: true,
            createdAt: true,
          },
        },
      },
    })
  },

  findByTaskAndNumber(
    taskId: string,
    number: number
  ): Promise<TestCaseRow | null> {
    return prisma.testCase.findFirst({
      where: { taskId, number, deletedAt: null },
      select: caseSelect,
    })
  },

  listForMilestone(milestoneId: string): Promise<TestCaseRow[]> {
    return prisma.testCase.findMany({
      where: { milestoneId, deletedAt: null },
      orderBy: { number: 'asc' },
      select: caseSelect,
    })
  },

  /** LUM-1135: any test case at all, soft-deleted included — they still own evidence blobs. */
  async hasAnyForMilestone(milestoneId: string): Promise<boolean> {
    const row = await prisma.testCase.findFirst({
      where: { milestoneId },
      select: { id: true },
    })
    return row !== null
  },

  findByMilestoneAndNumber(
    milestoneId: string,
    number: number
  ): Promise<TestCaseRow | null> {
    return prisma.testCase.findFirst({
      where: { milestoneId, number, deletedAt: null },
      select: caseSelect,
    })
  },

  findById(id: string): Promise<TestCaseRow | null> {
    return prisma.testCase.findFirst({
      where: { id, deletedAt: null },
      select: caseSelect,
    })
  },

  update(
    id: string,
    patch: UpdateTestCaseInput,
    tx?: Prisma.TransactionClient
  ): Promise<TestCaseRow> {
    const client = tx ?? prisma
    return client.testCase.update({
      where: { id },
      data: patch,
      select: caseSelect,
    })
  },

  /** 软删：run→case 的审计链必须活着。无论是否已有 run，都软删。 */
  async softDelete(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? prisma
    await client.testCase.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    })
  },

  createRun(
    input: CreateRunInput,
    tx?: Prisma.TransactionClient
  ): Promise<TestCaseRunRow> {
    const client = tx ?? prisma
    return client.testCaseRun.create({
      data: redactStoredFields(input, STORAGE_REDACTED_FIELDS.testCaseRun),
      select: runSelect,
    })
  },

  listRuns(testCaseId: string, limit = 50): Promise<TestCaseRunRow[]> {
    return prisma.testCaseRun.findMany({
      where: { testCaseId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: runSelect,
    })
  },

  /**
   * 陈旧性判定需要的 PR 快照：本任务名下的 PR 及其当前 head。
   * 同时服务于 service 的归属校验（PR 必须属于这个任务）与 web 的 PR 下拉。
   */
  listTaskPullRequests(taskId: string): Promise<TaskPullRequestRow[]> {
    return prisma.pullRequest.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      select: taskPrSelect,
    })
  },

  /**
   * 任务下所有 run，按用例分组、每组新到旧。
   *
   * 这本来就是一次查询把全部 run 取出来——早先的版本取完只留每组第一条，
   * 于是卡片上那个标着「Run history」的区域永远只显示最近一次（LUM-801
   * 走查时被自己的 TC1 抓到）。丢弃数据并没有省下任何查询，所以直接返回全量。
   */
  runsPerCase(taskId: string): Promise<Map<string, TestCaseRunRow[]>> {
    return groupRuns({ taskId })
  },

  /** LUM-1135: 同 runsPerCase，owner 为 milestone。 */
  runsPerCaseForMilestone(
    milestoneId: string
  ): Promise<Map<string, TestCaseRunRow[]>> {
    return groupRuns({ milestoneId })
  },

  /**
   * LUM-812: 一条 run，连同处置路径要校验的一切——它属于哪个用例/任务、归因是
   * 什么、有没有证据、已有裁定，以及**它是不是该用例最新的一条**。
   *
   * 最新与否要一起查：闸门只看每条用例最新一条 run，所以对一条已被更新的 run
   * 下裁定是无意义的（裁了也清不掉闸）。这也是 receipt 状态哈希的输入之一——
   * 读完信封到确认之间冒出一条新 run，未确认的 receipt 必须失效。
   */
  async findRunForDisposition(runId: string) {
    const run = await prisma.testCaseRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        taskId: true,
        milestoneId: true,
        testCaseId: true,
        result: true,
        failureAttribution: true,
        evidence: true,
        createdAt: true,
        disposition: {
          select: { id: true, disposition: true, dispositionedAt: true },
        },
        testCase: {
          select: { id: true, number: true, title: true, deletedAt: true },
        },
      },
    })
    if (!run) return null
    const latest = await prisma.testCaseRun.findFirst({
      where: { testCaseId: run.testCaseId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    return { ...run, isLatestForCase: latest?.id === run.id }
  },

  /**
   * 写入一条裁定 + 它的 TEST_CASE_DEFECT_DISPOSITIONED 事件，同一事务。
   * runId 唯一 —— 重复裁定由唯一索引挡住（P2002）。
   *
   * 必须原子：裁定行一落库闸门就清了，若事件写失败而行留着，调用方拿到 500、
   * 时间线上却没有这次裁定（LUM-812/TC1 生产实测：actorId 外键失败时正是如此）。
   */
  createDisposition(
    input: {
      runId: string
      taskId: string | null
      milestoneId?: string | null
      disposition: 'KNOWN_DEFECT' | 'NOT_A_DEFECT'
      note: string | null
      dispositionedById: string
      channel: 'WEB' | 'CLI'
    },
    activity: {
      actorId: string | null
      payload: Record<string, unknown>
    } | null
  ) {
    return prisma.$transaction(async tx => {
      const row = await tx.testCaseRunDisposition.create({ data: input })
      // LUM-1135: a milestone has no activity stream — the disposition row
      // and the audit log are its trail.
      if (activity !== null && input.taskId !== null) {
        await activityRepository.create(
          {
            taskId: input.taskId,
            actorId: activity.actorId,
            type: 'TEST_CASE_DEFECT_DISPOSITIONED',
            payload: activity.payload,
          },
          tx
        )
      }
      return row
    })
  },

  /**
   * LUM-1278 attention read model: the non-deleted cases of the given tasks
   * (caller's workspace) each with ONLY its latest run — the gate and the
   * verified predicate read nothing older.
   */
  async listWithLatestRunByTaskIds(workspaceId: string, taskIds: string[]) {
    if (taskIds.length === 0) return []
    const rows = await prisma.testCase.findMany({
      where: {
        taskId: { in: taskIds },
        deletedAt: null,
        task: { workspaceId },
      },
      select: {
        id: true,
        taskId: true,
        requiredEnvironment: true,
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            result: true,
            environment: true,
            failureAttribution: true,
            unprovenVerification: true,
            evidence: true,
            stepResults: true,
            pullRequestId: true,
            commitSha: true,
            commitDirty: true,
            disposition: { select: { id: true } },
          },
        },
      },
    })
    return rows.flatMap(r =>
      r.taskId === null
        ? []
        : [
            {
              id: r.id,
              taskId: r.taskId,
              requiredEnvironment: r.requiredEnvironment,
              latestRun: r.runs[0] ?? null,
            },
          ]
    )
  },
}
