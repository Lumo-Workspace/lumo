import { apiFetch } from './base'
import type { TestCase, TestCaseRun } from '@prisma/client'
import type {
  CreateTestCaseBody,
  UpdateTestCaseBody,
  RecordRunBody,
} from '@/lib/validation/test-case'
import type { TaskPullRequestSnapshot } from '@/lib/services/task-test-case.service'

export type TestCaseWithLatestRun = TestCase & {
  latestRun: TestCaseRun | null
}

export interface UploadedEvidenceFile {
  url: string
  filename: string
  contentType: string
  size: number
}

export const testCasesClient = {
  list(taskId: string): Promise<{
    testCases: TestCaseWithLatestRun[]
    pullRequests: TaskPullRequestSnapshot[]
  }> {
    return apiFetch(`/api/tasks/${taskId}/test-cases`)
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
    runs: TestCaseRun[]
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
