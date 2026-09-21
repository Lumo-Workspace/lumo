'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  testCasesClient,
  type TestCaseWithRuns,
} from '@/lib/api-client/test-cases'
import type { TaskPullRequestSnapshot } from '@/lib/test-cases/freshness'
import type {
  CreateTestCaseBody,
  UpdateTestCaseBody,
  RecordRunBody,
} from '@/lib/validation/test-case'
import { queryKeys } from '@/lib/query/keys'

interface TestCasesData {
  testCases: TestCaseWithRuns[]
  pullRequests: TaskPullRequestSnapshot[]
}

export interface UseTestCasesResult {
  testCases: TestCaseWithRuns[]
  pullRequests: TaskPullRequestSnapshot[]
  loading: boolean
  error: string | null
  add: (payload: CreateTestCaseBody) => Promise<void>
  update: (caseRef: string, payload: UpdateTestCaseBody) => Promise<void>
  remove: (caseRef: string) => Promise<void>
  recordRun: (
    caseRef: string,
    payload: RecordRunBody,
    files: File[]
  ) => Promise<void>
}

/**
 * LUM-801: 任务的 test case 列表与写操作。
 *
 * 刻意**不做乐观更新**：一条 run 落库时服务端还要解析 PR 号、快照失败步原文、
 * 写 activity——本地拼一个假行容易和真实结果对不上。写完 invalidate 重取。
 */
export function useTestCases(
  taskId: string,
  enabled = true
): UseTestCasesResult {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.taskTestCases(taskId)

  const query = useQuery<TestCasesData, Error>({
    queryKey,
    queryFn: () => testCasesClient.list(taskId),
    enabled,
  })

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey]
  )

  const add = useCallback(
    async (payload: CreateTestCaseBody) => {
      await testCasesClient.add(taskId, payload)
      await refresh()
    },
    [taskId, refresh]
  )

  const update = useCallback(
    async (caseRef: string, payload: UpdateTestCaseBody) => {
      await testCasesClient.update(taskId, caseRef, payload)
      await refresh()
    },
    [taskId, refresh]
  )

  const remove = useCallback(
    async (caseRef: string) => {
      await testCasesClient.remove(taskId, caseRef)
      await refresh()
    },
    [taskId, refresh]
  )

  const recordRun = useCallback(
    async (caseRef: string, payload: RecordRunBody, files: File[]) => {
      // 先传文件再落 run：两步之间失败会留下孤儿 blob，与仓库既有图片上传
      // 同性质，v1 接受，不做补偿事务。
      const uploaded =
        files.length > 0
          ? await testCasesClient.uploadEvidence(taskId, caseRef, files)
          : { files: [] }
      await testCasesClient.recordRun(taskId, caseRef, {
        ...payload,
        evidence: [
          ...(payload.evidence ?? []),
          ...uploaded.files.map(f => ({ type: 'file' as const, ...f })),
        ],
      })
      await refresh()
    },
    [taskId, refresh]
  )

  return {
    testCases: query.data?.testCases ?? [],
    pullRequests: query.data?.pullRequests ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    add,
    update,
    remove,
    recordRun,
  }
}
