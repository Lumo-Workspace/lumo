import {
  testCaseRunReviewRepository,
  type ReviewCandidateRow,
} from '@/lib/repositories/test-case-run-review.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { logger } from '@/lib/logger'
import { countEvidence } from '@/lib/test-cases/provability'
import {
  deriveFalseReportRate,
  deriveReviewPool,
  describeCriterionLink,
  isReviewable,
  latestReviewByRun,
  REVIEW_SAMPLE_SIZE,
  sampleForReview,
  sentBackOnLatestRuns,
  type CriterionLink,
  type FalseReportRate,
  type ReviewableRun,
} from '@/lib/test-cases/review'

/** 抽查页上的一条 run —— 扁平字段，组件不必往嵌套对象里伸手（LoD）。 */
export interface ReviewPoolItem {
  runId: string
  taskIdentifier: string
  taskTitle: string
  caseNumber: number
  caseTitle: string
  environment: 'LOCAL' | 'PREVIEW' | 'PRODUCTION'
  commitSha: string | null
  commitDirty: boolean | null
  note: string | null
  /** 原样透传给 EvidenceStrip。 */
  evidence: unknown
  recordedAt: string
  /**
   * LUM-819 返工：证据要对照的东西。没有这些，复核人只能判断证据「像不像
   * 样」，判断不了它「证没证明预期」。
   */
  setup: string | null
  steps: string[]
  verification: string[]
  expected: string
  criterion: CriterionLink
  pr: { number: number; url: string } | null
}

/** 任务页上一条 run 的最新复核（谁、何时、结论）。 */
export interface RunReviewSummary {
  accepted: boolean
  note: string | null
  reviewer: string
  reviewedAt: string
}

export interface ReviewPoolView {
  /** 本次随机抽出的待复核 run。 */
  sample: ReviewPoolItem[]
  /** 池子总量（还有多少条报了 PASS、有证据、没人看过）。 */
  poolSize: number
  rate: FalseReportRate
}

function toReviewable(row: ReviewCandidateRow): ReviewableRun {
  return {
    id: row.id,
    result: row.result,
    environment: row.environment,
    unprovenVerification: Array.isArray(row.unprovenVerification)
      ? (row.unprovenVerification as Array<{ index: number; text: string }>)
      : [],
    evidenceCount: countEvidence(row.evidence),
    requiredEnvironment: row.testCase.requiredEnvironment,
  }
}

function toPoolItem(row: ReviewCandidateRow): ReviewPoolItem {
  return {
    runId: row.id,
    taskIdentifier: `${row.task.team.identifier}-${row.task.number}`,
    taskTitle: row.task.title,
    caseNumber: row.testCase.number,
    caseTitle: row.testCase.title,
    environment: row.environment,
    commitSha: row.commitSha,
    commitDirty: row.commitDirty,
    note: row.note,
    evidence: row.evidence,
    recordedAt: row.createdAt.toISOString(),
    setup: row.testCase.setup,
    steps: row.testCase.steps,
    verification: row.testCase.verification,
    expected: row.testCase.expected,
    criterion: describeCriterionLink(row.testCase.criterion),
    pr: row.pullRequest
      ? { number: row.pullRequest.number, url: row.pullRequest.url }
      : null,
  }
}

export const testCaseReviewService = {
  /**
   * LUM-819 返工：一个任务上每条 run 的最新复核，复核人解析成显示名。
   * 回写到任务页的执行历史——抽查在别处做，结果要让任务负责人看得到。
   */
  async latestForTask(taskId: string): Promise<Map<string, RunReviewSummary>> {
    const latest = latestReviewByRun(
      await testCaseRunReviewRepository.listForTask(taskId)
    )
    const labels = await memberRepository.labelsByIds([
      ...new Set([...latest.values()].map(r => r.reviewedByMemberId)),
    ])
    const out = new Map<string, RunReviewSummary>()
    for (const [runId, r] of latest) {
      out.set(runId, {
        accepted: r.accepted,
        note: r.note,
        reviewer: labels.get(r.reviewedByMemberId) ?? r.reviewedByMemberId,
        reviewedAt: r.createdAt.toISOString(),
      })
    }
    return out
  },

  /**
   * LUM-819 返工：最新一次执行被抽查打回的用例，给 `task status` 的 advisory。
   *
   * fail-soft：读不出来就少一行提示，不该让整个 status 打不开（同
   * `readTestCaseAdvisories`）。**永远不进 DONE 闸**——闸门不读复核数据。
   */
  async sentBackForTask(
    taskId: string
  ): Promise<
    Array<{
      number: number
      title: string
      reviewer: string
      note: string | null
    }>
  > {
    try {
      const [cases, runsByCase, reviews] = await Promise.all([
        testCaseRepository.listForTask(taskId),
        testCaseRepository.runsPerCase(taskId),
        testCaseRunReviewRepository.listForTask(taskId),
      ])
      const latestRunIdByCase = new Map<string, string>()
      for (const [caseId, runs] of runsByCase) {
        // runsPerCase 已按 createdAt 新到旧排好。
        if (runs[0]) latestRunIdByCase.set(caseId, runs[0].id)
      }
      const hits = sentBackOnLatestRuns(cases, latestRunIdByCase, reviews)
      const labels = await memberRepository.labelsByIds([
        ...new Set(hits.map(h => h.review.reviewedByMemberId)),
      ])
      return hits.map(h => ({
        number: h.testCase.number,
        title: h.testCase.title,
        reviewer:
          labels.get(h.review.reviewedByMemberId) ??
          h.review.reviewedByMemberId,
        note: h.review.note,
      }))
    } catch (error) {
      logger.warn('runReview.sentBack.read.failed', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  },

  /**
   * 抽查页的数据：随机抽一批待复核 run + workspace 的虚报率。
   *
   * 只读，任何身份都能看；写（复核）只认浏览器会话，在路由上把关。
   */
  async getPool(
    workspaceId: string,
    opts: { sampleSize?: number; random?: () => number } = {}
  ): Promise<ReviewPoolView> {
    const [candidates, reviews] = await Promise.all([
      testCaseRunReviewRepository.listPassCandidates(workspaceId),
      testCaseRunReviewRepository.listForWorkspace(workspaceId),
    ])
    const byId = new Map(candidates.map(c => [c.id, c]))
    const pool = deriveReviewPool(candidates.map(toReviewable), reviews)
    const sample = sampleForReview(
      pool,
      opts.sampleSize ?? REVIEW_SAMPLE_SIZE,
      opts.random
    )
    return {
      sample: sample.map(r => toPoolItem(byId.get(r.id)!)),
      poolSize: pool.length,
      rate: deriveFalseReportRate(reviews),
    }
  },

  /**
   * 记一条人工复核。append-only：同一条 run 可以复核多次（改主意），读端取
   * 最新。**调用方必须已确认这是浏览器会话**——服务端分不出谁点的，agent
   * 代点就是凭空造一个「人已看过证据」的事实（路由在解析 body 前就拒 bearer）。
   *
   * 只收「封顶后仍是 PASS」的 run：零证据 / 环境不对 / 有未观察项的 PASS 已经
   * 被降级成 UNPROVEN，复核它是在复核一个已经不成立的结论。
   */
  async recordReview(
    runId: string,
    workspaceId: string,
    reviewerMemberId: string,
    input: { accepted: boolean; note?: string | null | undefined }
  ) {
    const run = await testCaseRunReviewRepository.findCandidate(
      runId,
      workspaceId
    )
    if (!run) {
      throw Object.assign(new Error('Test case run not found'), {
        status: 404,
      })
    }
    if (run.result !== 'PASS' || !isReviewable(toReviewable(run))) {
      throw Object.assign(
        new Error(
          'Only a reported PASS that still stands (evidence attached, run where the case can prove it, nothing left unobserved) can be reviewed'
        ),
        { status: 409 }
      )
    }
    const review = await testCaseRunReviewRepository.create({
      testCaseRunId: run.id,
      taskId: run.taskId,
      accepted: input.accepted,
      note: input.note?.trim() || null,
      reviewedByMemberId: reviewerMemberId,
    })
    return { review: { ...review, createdAt: review.createdAt.toISOString() } }
  },
}
