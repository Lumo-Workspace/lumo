import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

/**
 * LUM-819 (D): 抽查复核的读写。
 *
 * 复核表 append-only：这里**只有 create，没有 update / delete**。改主意就再
 * create 一条，读端取最新（`latestReviewByRun`）。别给它加 update——那会把
 * 「谁在什么时候改过主意」抹掉。
 */

/** 抽查页上一条候选 run 需要的列（只取需要的，ISP）。 */
const candidateSelect = {
  id: true,
  taskId: true,
  result: true,
  environment: true,
  unprovenVerification: true,
  evidence: true,
  note: true,
  commitSha: true,
  commitDirty: true,
  createdAt: true,
  // LUM-819 返工：复核要对照的东西——没有预期结果和标准原文，看证据只能看
  // 「像不像样」，判断不了「证没证明」。
  testCase: {
    select: {
      number: true,
      title: true,
      requiredEnvironment: true,
      setup: true,
      steps: true,
      verification: true,
      expected: true,
    },
  },
  pullRequest: { select: { number: true, url: true } },
  task: {
    select: {
      number: true,
      title: true,
      team: { select: { identifier: true } },
    },
  },
} satisfies Prisma.TestCaseRunSelect

type RawCandidateRow = Prisma.TestCaseRunGetPayload<{
  select: typeof candidateSelect
}>

/**
 * 抽查池只收任务级 run（LUM-1135：里程碑级 run 的 task 为 null，不进池子），
 * 所以这里把 taskId / task 收窄成非空。
 */
export type ReviewCandidateRow = Omit<RawCandidateRow, 'task' | 'taskId'> & {
  taskId: string
  task: NonNullable<RawCandidateRow['task']>
}

function taskOwned(row: RawCandidateRow): row is ReviewCandidateRow {
  return row.taskId !== null && row.task !== null
}

/**
 * 候选池取数上限（最新的 N 条上报 PASS）。抽查是估比率，不是清库存：池子
 * 只要足够大、足够新，抽出来的就有代表性，用不着把全部历史都读进内存。
 */
const CANDIDATE_LIMIT = 500

function inWorkspace(workspaceId: string): Prisma.TestCaseRunWhereInput {
  return {
    task: { project: { workspaceId } },
    // 被软删的用例不再是任何人的承诺，它的 run 不进池子。
    testCase: { deletedAt: null },
  }
}

export const testCaseRunReviewRepository = {
  async create(
    data: {
      testCaseRunId: string
      taskId: string
      accepted: boolean
      note: string | null
      reviewedByMemberId: string
    },
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.testCaseRunReview.create({
      data,
      select: {
        id: true,
        testCaseRunId: true,
        accepted: true,
        note: true,
        reviewedByMemberId: true,
        createdAt: true,
      },
    })
  },

  /**
   * 一个任务上的全部复核（回写到任务页与 task status 用）。读端按 run 取最新。
   */
  async listForTask(taskId: string) {
    return prisma.testCaseRunReview.findMany({
      where: { taskId },
      select: {
        testCaseRunId: true,
        accepted: true,
        note: true,
        reviewedByMemberId: true,
        createdAt: true,
      },
    })
  },

  /** workspace 内全部复核（虚报率与「已复核」排除都要全量）。 */
  async listForWorkspace(workspaceId: string) {
    return prisma.testCaseRunReview.findMany({
      where: { task: { project: { workspaceId } } },
      select: { testCaseRunId: true, accepted: true, createdAt: true },
    })
  },

  /**
   * 上报为 PASS 的最新 run（封顶与「已复核」的筛选在纯函数里做——封顶是读端
   * 推导，数据库里没有这一列可查）。
   */
  async listPassCandidates(workspaceId: string): Promise<ReviewCandidateRow[]> {
    const rows = await prisma.testCaseRun.findMany({
      where: {
        ...inWorkspace(workspaceId),
        taskId: { not: null },
        result: 'PASS',
      },
      select: candidateSelect,
      orderBy: { createdAt: 'desc' },
      take: CANDIDATE_LIMIT,
    })
    return rows.filter(taskOwned)
  },

  /** 单条 run，限定在调用方的 workspace 内（跨租户读回 null）。 */
  async findCandidate(
    runId: string,
    workspaceId: string
  ): Promise<ReviewCandidateRow | null> {
    const row = await prisma.testCaseRun.findFirst({
      where: { id: runId, ...inWorkspace(workspaceId) },
      select: candidateSelect,
    })
    return row && taskOwned(row) ? row : null
  },
}
