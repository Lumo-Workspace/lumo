import { apiFetch } from './base'
import type {
  TestCase,
  TestCaseRun,
  TestCaseDefectDisposition,
  TestCaseDispositionChannel,
} from '@prisma/client'
import type {
  CreateTestCaseBody,
  UpdateTestCaseBody,
  RecordRunBody,
} from '@/lib/validation/test-case'
import type { TaskPullRequestSnapshot } from '@/lib/test-cases/freshness'

/**
 * LUM-812: 一条 run 上的人类裁定。null = 还没人裁。
 *
 * 单独写出来而不是用 Prisma 的行类型：组件只需要这四个字段，`select` 里也只
 * 取了这些（ISP）。
 */
export interface RunDisposition {
  id: string
  disposition: TestCaseDefectDisposition
  note: string | null
  dispositionedById: string
  dispositionedAt: string | Date
  channel: TestCaseDispositionChannel
}

/** LUM-819 返工：一条 run 的最新抽查复核（谁、何时、结论）。 */
export interface RunReviewView {
  accepted: boolean
  note: string | null
  reviewer: string
  reviewedAt: string
}

/** 读端看到的一条 run —— Prisma 的行，外加它的裁定与最新抽查复核。 */
export type TestCaseRunView = TestCaseRun & {
  disposition: RunDisposition | null
  /** 可选：只有任务的用例列表带；单条详情等读端没有它。 */
  review?: RunReviewView | null
  /**
   * LUM-1008：执行人显示名。null = 这条 run 没记执行人；缺省 = 这个读端没带
   * （例如 recordRun 的回包）。
   */
  executedBy?: string | null
}

/** 列表里的一条用例，带它全部的执行记录（新到旧）。 */
export type TestCaseWithRuns = TestCase & {
  runs: TestCaseRunView[]
}

export interface UploadedEvidenceFile {
  url: string
  filename: string
  contentType: string
  size: number
}

export const testCasesClient = {
  list(taskId: string): Promise<{
    testCases: TestCaseWithRuns[]
    pullRequests: TaskPullRequestSnapshot[]
  }> {
    return apiFetch(`/api/tasks/${taskId}/test-cases`)
  },

  /**
   * LUM-812: 对一条「证明了坏」的 run 落裁定，清掉它对 DONE 的拦截。
   *
   * web 这条路不带回执——面板上就是那个人自己在点，没有需要转述的批准。
   * 服务端按身份来源打 `channel: 'WEB'`。
   */
  disposeDefect(
    taskId: string,
    runId: string,
    payload: { disposition: TestCaseDefectDisposition; note?: string | null }
  ): Promise<RunDisposition> {
    return apiFetch(
      `/api/tasks/${taskId}/test-case-runs/${runId}/disposition`,
      {
        method: 'POST',
        body: payload,
      }
    )
  },

  add(
    taskId: string,
    payload: CreateTestCaseBody
  ): Promise<{ testCase: TestCase }> {
    return apiFetch(`/api/tasks/${taskId}/test-cases`, {
      method: 'POST',
      body: payload,
    })
  },

  get(
    taskId: string,
    caseRef: string
  ): Promise<{
    testCase: TestCase
    runs: Array<TestCaseRun & { executedBy: string | null }>
    pullRequests: TaskPullRequestSnapshot[]
  }> {
    return apiFetch(`/api/tasks/${taskId}/test-cases/${caseRef}`)
  },

  update(
    taskId: string,
    caseRef: string,
    payload: UpdateTestCaseBody
  ): Promise<{ testCase: TestCase }> {
    return apiFetch(`/api/tasks/${taskId}/test-cases/${caseRef}`, {
      method: 'PATCH',
      body: payload,
    })
  },

  remove(taskId: string, caseRef: string): Promise<{ ok: true }> {
    return apiFetch(`/api/tasks/${taskId}/test-cases/${caseRef}`, {
      method: 'DELETE',
    })
  },

  recordRun(
    taskId: string,
    caseRef: string,
    payload: RecordRunBody
  ): Promise<{ run: TestCaseRun }> {
    return apiFetch(`/api/tasks/${taskId}/test-cases/${caseRef}/runs`, {
      method: 'POST',
      body: payload,
    })
  },

  /** multipart —— 绕过 apiFetch 的 JSON body 约定，直接 fetch。 */
  async uploadEvidence(
    taskId: string,
    caseRef: string,
    files: File[]
  ): Promise<{ files: UploadedEvidenceFile[] }> {
    const fd = new FormData()
    for (const f of files) fd.append('file', f)
    const res = await fetch(
      `/api/tasks/${taskId}/test-cases/${caseRef}/evidence`,
      { method: 'POST', body: fd }
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string
      } | null
      throw new Error(body?.error ?? `Upload failed (${res.status})`)
    }
    return res.json() as Promise<{ files: UploadedEvidenceFile[] }>
  },
}
