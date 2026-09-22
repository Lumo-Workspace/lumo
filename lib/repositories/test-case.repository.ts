import { prisma } from '@/lib/db/prisma'
import type {
  Prisma,
  TestCaseFailureAttribution,
  TestCasePhase,
  TestCaseRunResult,
  TestEnvironment,
} from '@prisma/client'

export interface CreateTestCaseInput {
  taskId: string
  title: string
  setup: string | null
  steps: string[]
  verification: string[]
  expected: string
  /** LUM-808: 省略 / null = 不限。与 run 的 environment 不同，这里「不限」
   *  是有意义的默认，不需要逼调用方表态。 */
  requiredEnvironment?: TestEnvironment | null
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
  taskId: string
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
  result: true,
  environment: true,
  failedPhase: true,
  failedIndex: true,
  failedStepText: true,
  failureAttribution: true,
  unprovenVerification: true,
  evidence: true,
  note: true,
  pullRequestId: true,
  commitSha: true,
  commitDirty: true,
  executedByMemberId: true,
  sourceSessionId: true,
  createdAt: true,
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

/** max+1 分配的重试预算（同 Idea 编号，LUM-661）。 */
const NUMBER_RETRIES = 5

function isUniqueCollision(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'P2002'
}

/**
 * LUM-801 哑写层：封装 Prisma 查询、返回领域行。**不含业务规则、不做权限校验**
 * （CLAUDE.md 分层）。跨字段一致性与 400 语义在 task-test-case.service.ts。
 */
export const testCaseRepository = {
  /**
   * 分配任务内 1-based `number` 并创建。并发下两个调用可能算出同一个 max+1，
   * 由 @@unique([taskId, number]) 兜底成 P2002，这里重算后重试。
   */
  async createWithNumber(
    input: CreateTestCaseInput,
    tx?: Prisma.TransactionClient
  ): Promise<TestCaseRow> {
    const client = tx ?? prisma
    let lastError: unknown
    for (let attempt = 0; attempt < NUMBER_RETRIES; attempt++) {
      const agg = await client.testCase.aggregate({
        where: { taskId: input.taskId },
        _max: { number: true },
      })
      const next = (agg._max.number ?? 0) + 1
      try {
        return await client.testCase.create({
          data: { ...input, number: next },
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

  findByTaskAndNumber(
    taskId: string,
    number: number
  ): Promise<TestCaseRow | null> {
    return prisma.testCase.findFirst({
      where: { taskId, number, deletedAt: null },
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
    return client.testCaseRun.create({ data: input, select: runSelect })
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
  async runsPerCase(taskId: string): Promise<Map<string, TestCaseRunRow[]>> {
    const rows = await prisma.testCaseRun.findMany({
      where: { taskId },
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
  },
}
