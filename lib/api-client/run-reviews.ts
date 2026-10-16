import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { RunReviewBody } from '@/lib/validation/test-case'
import type { FalseReportRate } from '@/lib/test-cases/review'

/** 抽查页上的一条 run（与 service 的 `ReviewPoolItem` 同形）。 */
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
  evidence: unknown
  recordedAt: string
  /** LUM-1191: 执行人显示名；null = 未记录。 */
  executedBy: string | null
  sourceSessionId: string | null
  /** LUM-819 返工：证据要对照的东西。 */
  setup: string | null
  steps: string[]
  verification: string[]
  expected: string
  pr: { number: number; url: string } | null
}

export interface ReviewPoolView {
  sample: ReviewPoolItem[]
  poolSize: number
  rate: FalseReportRate
}

/** LUM-819 (D): 抽查池与复核。 */
export const runReviewsClient = {
  /** GET 一批随机抽出的待复核 run + 虚报率。 */
  pool() {
    return apiFetch<ReviewPoolView>(API.runReviews.pool)
  },

  /** POST 一条复核。服务端只认浏览器会话。 */
  review(runId: string, body: RunReviewBody) {
    return apiFetch<{ review: { id: string } }>(API.runReviews.review(runId), {
      method: 'POST',
      body,
    })
  },
}
