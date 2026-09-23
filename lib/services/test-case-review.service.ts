import {
  testCaseRunReviewRepository,
  type ReviewCandidateRow,
} from '@/lib/repositories/test-case-run-review.repository'
import { countEvidence } from '@/lib/test-cases/provability'
import {
  deriveFalseReportRate,
  deriveReviewPool,
  isReviewable,
  REVIEW_SAMPLE_SIZE,
  sampleForReview,
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
  /** 原样透传给 EvidenceStrip；抽查的全部依据就在这里。 */
  evidence: unknown
  recordedAt: string
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
  }
}

export const testCaseReviewService = {
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
